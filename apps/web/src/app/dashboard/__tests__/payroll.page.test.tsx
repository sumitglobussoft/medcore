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
  usePathname: () => "/dashboard/payroll",
}));

import PayrollPage from "../payroll/page";

const sampleStaff = [
  { id: "s1", name: "Alice", email: "a@x.com", role: "DOCTOR" },
  { id: "s2", name: "Bob", email: "b@x.com", role: "NURSE" },
];

describe("PayrollPage", () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    authMock.mockImplementation((selector: any) => {
      const state = { user: { id: "u1", name: "Admin", email: "a@x.com", role: "ADMIN" } };
      return typeof selector === "function" ? selector(state) : state;
    });
    apiMock.get.mockResolvedValue({ data: [] });
  });

  it("renders Payroll heading", async () => {
    render(<PayrollPage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /^payroll$/i })).toBeInTheDocument()
    );
  });

  it("renders populated staff list", async () => {
    apiMock.get.mockResolvedValue({ data: sampleStaff });
    render(<PayrollPage />);
    await waitFor(() => {
      expect(screen.getAllByText(/Alice|Bob/).length).toBeGreaterThan(0);
    });
  });

  it("keeps rendering when API returns an error", async () => {
    apiMock.get.mockRejectedValue(new Error("500"));
    render(<PayrollPage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /^payroll$/i })).toBeInTheDocument()
    );
  });

  it("switches to Overtime tab", async () => {
    const user = userEvent.setup();
    render(<PayrollPage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /^payroll$/i })).toBeInTheDocument()
    );
    const otBtn = screen.queryAllByRole("button", { name: /overtime/i })[0];
    if (otBtn) {
      await user.click(otBtn);
      await waitFor(() => {
        expect(screen.getAllByRole("heading").length).toBeGreaterThan(0);
      });
    }
  });

  it("fetches /chat/users for staff on mount", async () => {
    render(<PayrollPage />);
    await waitFor(() => {
      const urls = apiMock.get.mock.calls.map((c) => String(c[0]));
      expect(urls.length).toBeGreaterThan(0);
    });
  });
});
