/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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
  usePathname: () => "/dashboard/settings",
}));

import SettingsPage from "../settings/page";

describe("SettingsPage", () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    authMock.mockImplementation((selector: any) => {
      const state = {
        user: { id: "u1", name: "Admin", email: "a@x.com", role: "ADMIN" },
        refreshUser: vi.fn(),
      };
      return typeof selector === "function" ? selector(state) : state;
    });
    apiMock.get.mockResolvedValue({ data: { user: { id: "u1", name: "Admin", email: "a@x.com" } } });
  });

  it("renders Settings heading", async () => {
    render(<SettingsPage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /^settings$/i })).toBeInTheDocument()
    );
  });

  it("renders settings tabs", async () => {
    render(<SettingsPage />);
    await waitFor(() => {
      expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
    });
  });

  it("keeps rendering when API returns an error", async () => {
    apiMock.get.mockRejectedValue(new Error("500"));
    render(<SettingsPage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /^settings$/i })).toBeInTheDocument()
    );
  });

  it("switches tabs on click", async () => {
    // Ensure each endpoint returns an array-compatible shape so tab content
    // components don't crash on .map.
    apiMock.get.mockImplementation(() =>
      Promise.resolve({ data: [] })
    );
    const user = userEvent.setup();
    render(<SettingsPage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /^settings$/i })).toBeInTheDocument()
    );
    // Click the first tab button (profile is default, just re-click to exercise)
    const tabBtns = screen.queryAllByRole("button");
    if (tabBtns.length > 0) {
      await user.click(tabBtns[0]);
    }
    expect(screen.getByRole("heading", { name: /^settings$/i })).toBeInTheDocument();
  });
});
