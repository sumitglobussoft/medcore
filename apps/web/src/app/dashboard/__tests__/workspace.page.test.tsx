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
  usePathname: () => "/dashboard/workspace",
}));

import WorkspacePage from "../workspace/page";

describe("WorkspacePage", () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    authMock.mockImplementation((selector: any) => {
      const state = {
        user: { id: "u1", name: "Dr", email: "d@x.com", role: "DOCTOR" },
        isLoading: false,
      };
      return typeof selector === "function" ? selector(state) : state;
    });
    apiMock.get.mockResolvedValue({ data: [] });
  });

  it("renders Workspace heading with empty data", async () => {
    render(<WorkspacePage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /workspace/i })).toBeInTheDocument()
    );
  });

  it("renders after fetching doctor workspace data", async () => {
    apiMock.get.mockResolvedValue({ data: [] });
    render(<WorkspacePage />);
    await waitFor(() => {
      expect(apiMock.get).toHaveBeenCalled();
    });
  });

  it("keeps rendering when API returns an error", async () => {
    apiMock.get.mockRejectedValue(new Error("500"));
    render(<WorkspacePage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /workspace/i })).toBeInTheDocument()
    );
  });

  it("handles isLoading state from auth store", async () => {
    authMock.mockImplementation((selector: any) => {
      const state = { user: null, isLoading: true };
      return typeof selector === "function" ? selector(state) : state;
    });
    render(<WorkspacePage />);
    // still renders without crash
    await waitFor(() => {
      expect(document.body).toBeTruthy();
    });
  });
});
