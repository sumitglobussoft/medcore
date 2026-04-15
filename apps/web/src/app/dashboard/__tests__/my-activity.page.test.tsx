/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const { apiMock, authMock, toastMock } = vi.hoisted(() => ({
  apiMock: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  authMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/lib/store", () => ({ useAuthStore: authMock }));
vi.mock("@/lib/toast", () => ({ toast: toastMock }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/dashboard/my-activity",
}));

import MyActivityPage from "../my-activity/page";

const sampleActivity = [
  { id: "a1", action: "LOGIN", resource: "auth", createdAt: new Date().toISOString(), metadata: {} },
  { id: "a2", action: "UPDATE_PROFILE", resource: "user", createdAt: new Date().toISOString(), metadata: {} },
];

describe("MyActivityPage", () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    authMock.mockImplementation((selector: any) => {
      const state = { user: { id: "u1", name: "Admin", email: "a@x.com", role: "ADMIN" } };
      return typeof selector === "function" ? selector(state) : state;
    });
    apiMock.get.mockResolvedValue({ data: [] });
  });

  it("renders My Activity heading with empty data", async () => {
    render(<MyActivityPage />);
    await waitFor(() =>
      expect(screen.getAllByRole("heading").length).toBeGreaterThan(0)
    );
  });

  it("renders populated activity entries", async () => {
    apiMock.get.mockResolvedValue({ data: sampleActivity });
    render(<MyActivityPage />);
    await waitFor(() => {
      expect(screen.getAllByText(/LOGIN|UPDATE_PROFILE/).length).toBeGreaterThan(0);
    });
  });

  it("keeps rendering when API returns an error", async () => {
    apiMock.get.mockRejectedValue(new Error("500"));
    render(<MyActivityPage />);
    await waitFor(() => {
      expect(apiMock.get).toHaveBeenCalled();
    });
  });

  it("fetches /auth/my-activity on mount", async () => {
    render(<MyActivityPage />);
    await waitFor(() => {
      const urls = apiMock.get.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes("/auth/my-activity"))).toBe(true);
    });
  });
});
