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
  usePathname: () => "/dashboard/billing/patient/test-id",
  useParams: () => ({ patientId: "test-id" }),
}));

import PatientBillingPage from "../billing/patient/[patientId]/page";

const sampleResponse = {
  totalOutstanding: 5000,
  invoices: [
    {
      id: "inv1",
      invoiceNumber: "INV-001",
      status: "PENDING",
      total: 3000,
      balance: 3000,
      createdAt: new Date().toISOString(),
      patient: {
        id: "p1",
        mrNumber: "MR-1",
        user: { name: "Aarav Mehta", phone: "9000000001", email: "a@x.com" },
      },
    },
    {
      id: "inv2",
      invoiceNumber: "INV-002",
      status: "PARTIAL",
      total: 4000,
      balance: 2000,
      createdAt: new Date().toISOString(),
      patient: {
        id: "p1",
        mrNumber: "MR-1",
        user: { name: "Aarav Mehta", phone: "9000000001", email: "a@x.com" },
      },
    },
  ],
};

describe("PatientBillingPage", () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    apiMock.post.mockReset();
    authMock.mockImplementation((selector: any) => {
      const state = { user: { id: "u1", name: "Admin", email: "a@x.com", role: "ADMIN" } };
      return typeof selector === "function" ? selector(state) : state;
    });
  });

  it("shows loading state initially", async () => {
    apiMock.get.mockReturnValue(new Promise(() => {}));
    render(<PatientBillingPage />);
    await waitFor(() =>
      expect(screen.getByText(/loading/i)).toBeInTheDocument()
    );
  });

  it("renders populated invoices", async () => {
    apiMock.get.mockResolvedValue({ data: sampleResponse });
    render(<PatientBillingPage />);
    await waitFor(() =>
      expect(screen.getAllByText("Aarav Mehta").length).toBeGreaterThan(0)
    );
    expect(screen.getAllByText(/INV-001/).length).toBeGreaterThan(0);
  });

  it("renders empty state when no invoices", async () => {
    apiMock.get.mockResolvedValue({
      data: { totalOutstanding: 0, invoices: [] },
    });
    render(<PatientBillingPage />);
    await waitFor(() =>
      expect(screen.getAllByText(/no outstanding invoices/i).length).toBeGreaterThan(0)
    );
  });

  it("keeps rendering when API rejects", async () => {
    apiMock.get.mockRejectedValue(new Error("500"));
    render(<PatientBillingPage />);
    await waitFor(() =>
      expect(screen.getByText(/back to billing/i)).toBeInTheDocument()
    );
  });

  it("disabled bulk payment button when nothing selected", async () => {
    apiMock.get.mockResolvedValue({ data: sampleResponse });
    const user = userEvent.setup();
    render(<PatientBillingPage />);
    await waitFor(() =>
      expect(screen.getAllByText(/INV-001/).length).toBeGreaterThan(0)
    );
    const bulkBtn = screen.getByRole("button", { name: /record bulk payment/i });
    expect(bulkBtn).toBeDisabled();
    await user.click(bulkBtn); // no-op but doesn't crash
  });
});
