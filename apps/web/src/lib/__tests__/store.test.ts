import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the api module BEFORE importing the store.
vi.mock("../api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

import { useAuthStore } from "../store";
import { api } from "../api";

const mockedPost = api.post as unknown as ReturnType<typeof vi.fn>;
const mockedGet = api.get as unknown as ReturnType<typeof vi.fn>;

const USER = {
  id: "u1",
  email: "a@b.com",
  name: "Alice",
  role: "DOCTOR",
};
const TOKENS = { accessToken: "acc-1", refreshToken: "ref-1" };

describe("useAuthStore", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useAuthStore.setState({ user: null, token: null, isLoading: true });
    mockedPost.mockReset();
    mockedGet.mockReset();
  });

  it("login stores token and user on plain success", async () => {
    mockedPost.mockResolvedValueOnce({
      success: true,
      data: { user: USER, tokens: TOKENS },
    });
    const res = await useAuthStore.getState().login("a@b.com", "pwd");
    expect(res.twoFactorRequired).toBeUndefined();
    expect(window.localStorage.getItem("medcore_token")).toBe("acc-1");
    expect(window.localStorage.getItem("medcore_refresh")).toBe("ref-1");
    expect(useAuthStore.getState().user?.id).toBe("u1");
    expect(useAuthStore.getState().token).toBe("acc-1");
  });

  it("login returns tempToken when 2FA required", async () => {
    mockedPost.mockResolvedValueOnce({
      success: true,
      data: { twoFactorRequired: true, tempToken: "temp-123" },
    });
    const res = await useAuthStore.getState().login("a@b.com", "pwd");
    expect(res.twoFactorRequired).toBe(true);
    expect(res.tempToken).toBe("temp-123");
    // Does NOT log the user in yet
    expect(window.localStorage.getItem("medcore_token")).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it("verify2FA completes login with user + tokens", async () => {
    mockedPost.mockResolvedValueOnce({
      success: true,
      data: { user: USER, tokens: TOKENS },
    });
    await useAuthStore.getState().verify2FA("temp-123", "123456");
    expect(useAuthStore.getState().user?.id).toBe("u1");
    expect(window.localStorage.getItem("medcore_token")).toBe("acc-1");
  });

  it("logout clears state and localStorage", () => {
    window.localStorage.setItem("medcore_token", "x");
    window.localStorage.setItem("medcore_refresh", "y");
    useAuthStore.setState({ user: USER as any, token: "x" });
    useAuthStore.getState().logout();
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().token).toBeNull();
    expect(window.localStorage.getItem("medcore_token")).toBeNull();
    expect(window.localStorage.getItem("medcore_refresh")).toBeNull();
  });

  it("loadSession restores user when a token exists", async () => {
    window.localStorage.setItem("medcore_token", "acc-1");
    mockedGet.mockResolvedValueOnce({ success: true, data: USER });
    await useAuthStore.getState().loadSession();
    expect(useAuthStore.getState().user?.id).toBe("u1");
    expect(useAuthStore.getState().token).toBe("acc-1");
    expect(useAuthStore.getState().isLoading).toBe(false);
  });

  it("loadSession with no token sets isLoading=false and no user", async () => {
    await useAuthStore.getState().loadSession();
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().isLoading).toBe(false);
  });

  it("loadSession clears invalid token when /auth/me fails", async () => {
    window.localStorage.setItem("medcore_token", "bad");
    mockedGet.mockRejectedValueOnce(new Error("401"));
    await useAuthStore.getState().loadSession();
    expect(useAuthStore.getState().user).toBeNull();
    expect(window.localStorage.getItem("medcore_token")).toBeNull();
  });

  // Issues #346 + #258: role-clobber defence — refuse to silently mutate
  // a cached user's role to a different role from /auth/me.
  it("refreshUser refuses to elevate role mid-session (Issues #346, #258)", async () => {
    window.localStorage.setItem("medcore_token", "acc-1");
    useAuthStore.setState({
      user: { ...USER, role: "RECEPTION" } as any,
      token: "acc-1",
      isLoading: false,
    });
    // Stub the window.location object — jsdom won't let us redefine
    // .replace on the existing one without a `delete` first.
    const original = window.location;
    delete (window as any).location;
    (window as any).location = {
      ...original,
      replace: vi.fn(),
      pathname: "/dashboard",
      search: "",
    };
    try {
      mockedGet.mockResolvedValueOnce({
        success: true,
        data: { ...USER, role: "DOCTOR" }, // server "elevation"
      });
      await useAuthStore.getState().refreshUser();
      // Role-clobber guard: state should be cleared and token wiped.
      expect(useAuthStore.getState().user).toBeNull();
      expect(useAuthStore.getState().token).toBeNull();
      expect(window.localStorage.getItem("medcore_token")).toBeNull();
    } finally {
      (window as any).location = original;
    }
  });

  it("loadSession refuses to elevate role on app boot (Issues #346, #258)", async () => {
    window.localStorage.setItem("medcore_token", "acc-1");
    // Pre-seed a cached RECEPTION session (e.g. from a previous tab).
    useAuthStore.setState({
      user: { ...USER, role: "RECEPTION" } as any,
      token: "acc-1",
      isLoading: true,
    });
    mockedGet.mockResolvedValueOnce({
      success: true,
      data: { ...USER, role: "ADMIN" }, // attempted clobber to ADMIN
    });
    await useAuthStore.getState().loadSession();
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().token).toBeNull();
    expect(useAuthStore.getState().isLoading).toBe(false);
    expect(window.localStorage.getItem("medcore_token")).toBeNull();
  });

  it("refreshUser still updates non-role fields when role matches", async () => {
    window.localStorage.setItem("medcore_token", "acc-1");
    useAuthStore.setState({
      user: { ...USER, name: "Old Name" } as any,
      token: "acc-1",
      isLoading: false,
    });
    mockedGet.mockResolvedValueOnce({
      success: true,
      data: { ...USER, name: "New Name", role: "DOCTOR" },
    });
    await useAuthStore.getState().refreshUser();
    expect(useAuthStore.getState().user?.name).toBe("New Name");
    expect(useAuthStore.getState().user?.role).toBe("DOCTOR");
  });
});
