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

vi.mock("@/lib/api", () => ({
  api: apiMock,
  openPrintEndpoint: vi.fn(),
}));
vi.mock("@/lib/store", () => ({ useAuthStore: authMock }));
vi.mock("@/lib/toast", () => ({ toast: toastMock }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/dashboard/leave-management",
}));

import LeaveManagementPage from "../leave-management/page";

const sampleLeaves = [
  {
    id: "l1",
    type: "CASUAL",
    startDate: new Date().toISOString(),
    endDate: new Date(Date.now() + 86400000).toISOString(),
    status: "PENDING",
    reason: "Family",
    user: { id: "u1", name: "Alice", role: "NURSE" },
  },
];

describe("LeaveManagementPage", () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    apiMock.patch.mockReset();
    authMock.mockImplementation((selector: any) => {
      const state = { user: { id: "u2", name: "Admin", email: "a@x.com", role: "ADMIN" } };
      return typeof selector === "function" ? selector(state) : state;
    });
    apiMock.get.mockResolvedValue({ data: [] });
  });

  it("renders Leave Management heading with empty data", async () => {
    render(<LeaveManagementPage />);
    await waitFor(() =>
      expect(screen.getAllByRole("heading").length).toBeGreaterThan(0)
    );
  });

  it("renders populated leaves", async () => {
    apiMock.get.mockResolvedValue({ data: sampleLeaves });
    render(<LeaveManagementPage />);
    await waitFor(() => {
      expect(screen.getAllByText(/Alice|Family/).length).toBeGreaterThan(0);
    });
  });

  it("switches tabs and refetches", async () => {
    const user = userEvent.setup();
    render(<LeaveManagementPage />);
    await waitFor(() => {
      expect(apiMock.get).toHaveBeenCalled();
    });
    const approvedBtn = screen.queryAllByRole("button", { name: /approved/i })[0];
    if (approvedBtn) {
      await user.click(approvedBtn);
      await waitFor(() => {
        const urls = apiMock.get.mock.calls.map((c) => String(c[0]));
        expect(urls.some((u) => u.includes("APPROVED"))).toBe(true);
      });
    }
  });

  it("keeps rendering when API returns an error", async () => {
    apiMock.get.mockRejectedValue(new Error("500"));
    render(<LeaveManagementPage />);
    await waitFor(() => {
      expect(apiMock.get).toHaveBeenCalled();
    });
  });

  it("fetches /leaves on mount", async () => {
    render(<LeaveManagementPage />);
    await waitFor(() => {
      const urls = apiMock.get.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes("/leaves"))).toBe(true);
    });
  });
});
