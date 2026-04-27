import { describe, it, expect, vi, beforeEach } from "vitest";
import { api, openPrintEndpoint, __resetAuthExpiredLatchForTests } from "../api";
import { toast } from "../toast";

// Capture the jsdom default location once so 401-redirect tests can stub
// `window.location` and the next test still sees a clean slate.
const ORIGINAL_LOCATION = window.location;

describe("api client", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
    __resetAuthExpiredLatchForTests();
    Object.defineProperty(window, "location", {
      value: ORIGINAL_LOCATION,
      writable: true,
      configurable: true,
    });
  });

  it("GET attaches Authorization header when a token is stored", async () => {
    window.localStorage.setItem("medcore_token", "tok-1");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), { status: 200 })
      );
    await api.get("/ping");
    expect(fetchSpy).toHaveBeenCalled();
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer tok-1"
    );
  });

  it("POST sends JSON body with Content-Type and stringified payload", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), { status: 200 })
      );
    await api.post("/thing", { a: 1 });
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json"
    );
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
  });

  it("explicit token option overrides localStorage value", async () => {
    window.localStorage.setItem("medcore_token", "stored");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), { status: 200 })
      );
    await api.get("/x", { token: "explicit" });
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer explicit"
    );
  });

  it("error response throws Error with the server message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Nope" }), { status: 400 })
    );
    await expect(api.get("/err")).rejects.toThrow("Nope");
  });

  // Issues #101 + #132: any 401 response from the API should clear the
  // stored auth tokens, toast the user, and redirect to /login. Single-fire
  // per page lifecycle so a burst of parallel 401s doesn't spam toasts.
  it("401 response clears auth tokens, toasts, and redirects to /login", async () => {
    window.localStorage.setItem("medcore_token", "expired-token");
    window.localStorage.setItem("medcore_refresh", "expired-refresh");

    const replaceSpy = vi.fn();
    Object.defineProperty(window, "location", {
      value: {
        pathname: "/dashboard/pharmacy",
        search: "",
        replace: replaceSpy,
      },
      writable: true,
    });
    const toastSpy = vi.spyOn(toast, "error");

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
    );

    await expect(api.get("/some-protected-route")).rejects.toThrow();
    expect(window.localStorage.getItem("medcore_token")).toBeNull();
    expect(window.localStorage.getItem("medcore_refresh")).toBeNull();
    expect(toastSpy).toHaveBeenCalledWith(
      "Your session has expired, please sign in again.",
      6000
    );
    expect(replaceSpy).toHaveBeenCalled();
    expect(replaceSpy.mock.calls[0][0]).toMatch(/^\/login\?next=/);
  });

  it("401 fires only once per page lifecycle (no toast spam)", async () => {
    window.localStorage.setItem("medcore_token", "expired-token");
    const replaceSpy = vi.fn();
    Object.defineProperty(window, "location", {
      value: { pathname: "/dashboard", search: "", replace: replaceSpy },
      writable: true,
    });
    const toastSpy = vi.spyOn(toast, "error");

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
    );

    await expect(api.get("/x")).rejects.toThrow();
    await expect(api.get("/y")).rejects.toThrow();
    await expect(api.get("/z")).rejects.toThrow();

    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(replaceSpy).toHaveBeenCalledTimes(1);
  });

  it("401 with skip401Redirect option throws but does NOT redirect", async () => {
    window.localStorage.setItem("medcore_token", "stale");
    const replaceSpy = vi.fn();
    Object.defineProperty(window, "location", {
      value: { pathname: "/dashboard", search: "", replace: replaceSpy },
      writable: true,
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
    );

    await expect(
      api.get("/auth/me", { skip401Redirect: true })
    ).rejects.toThrow();
    expect(replaceSpy).not.toHaveBeenCalled();
  });

  it("401 on /login itself does NOT redirect (would loop)", async () => {
    const replaceSpy = vi.fn();
    Object.defineProperty(window, "location", {
      value: { pathname: "/login", search: "", replace: replaceSpy },
      writable: true,
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: "Invalid email or password" }),
        { status: 401 }
      )
    );

    await expect(api.post("/auth/login", { email: "x", password: "y" })).rejects.toThrow();
    expect(replaceSpy).not.toHaveBeenCalled();
  });

  it("openPrintEndpoint opens a new window, fetches HTML, writes document", async () => {
    const doc = {
      open: vi.fn(),
      write: vi.fn(),
      close: vi.fn(),
    };
    const fakeWin = { document: doc, close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(fakeWin as any);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("<html>OK</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      })
    );
    await openPrintEndpoint("/print/123");
    expect(window.open).toHaveBeenCalled();
    expect(doc.open).toHaveBeenCalled();
    expect(doc.write).toHaveBeenCalledWith("<html>OK</html>");
    expect(doc.close).toHaveBeenCalled();
  });
});
