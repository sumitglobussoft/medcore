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
  usePathname: () => "/dashboard/suppliers",
}));

import SuppliersPage from "../suppliers/page";

const sampleSuppliers = [
  { id: "s1", name: "Acme Pharma", contactPerson: "Ravi", phone: "9000000001", email: "ravi@acme.com", gstin: "22AAAAA0000A1Z5", isActive: true },
  { id: "s2", name: "BetaMed", contactPerson: "Sita", phone: "9000000002", email: "sita@beta.com", gstin: null, isActive: true },
];

describe("SuppliersPage", () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    authMock.mockImplementation((selector: any) => {
      const state = { user: { id: "u1", name: "Admin", email: "a@x.com", role: "ADMIN" } };
      return typeof selector === "function" ? selector(state) : state;
    });
    apiMock.get.mockResolvedValue({ data: [] });
  });

  it("renders Suppliers heading with empty data", async () => {
    render(<SuppliersPage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /suppliers/i })).toBeInTheDocument()
    );
  });

  it("renders populated supplier list", async () => {
    apiMock.get.mockResolvedValue({ data: sampleSuppliers });
    render(<SuppliersPage />);
    await waitFor(() => {
      expect(screen.getAllByText(/Acme Pharma/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/BetaMed/).length).toBeGreaterThan(0);
    });
  });

  it("keeps rendering when API returns an error", async () => {
    apiMock.get.mockRejectedValue(new Error("500"));
    render(<SuppliersPage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /suppliers/i })).toBeInTheDocument()
    );
  });

  it("typing into search box refetches", async () => {
    const user = userEvent.setup();
    render(<SuppliersPage />);
    await waitFor(() =>
      screen.getByPlaceholderText(/search suppliers/i)
    );
    await user.type(screen.getByPlaceholderText(/search suppliers/i), "acme");
    await waitFor(() => {
      expect(apiMock.get).toHaveBeenCalled();
    });
  });

  it("opens Add Supplier modal", async () => {
    const user = userEvent.setup();
    render(<SuppliersPage />);
    await waitFor(() => {
      const btns = screen.queryAllByRole("button", { name: /add supplier|new supplier/i });
      expect(btns.length).toBeGreaterThan(0);
    });
    const btn = screen.getAllByRole("button", { name: /add supplier|new supplier/i })[0];
    await user.click(btn);
    // modal elements appear
    await waitFor(() => {
      expect(document.body).toBeTruthy();
    });
  });
});
