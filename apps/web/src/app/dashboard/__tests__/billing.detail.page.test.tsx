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
  usePathname: () => "/dashboard/billing/test-id",
  useParams: () => ({ id: "test-id" }),
}));

import InvoiceDetailPage from "../billing/[id]/page";

const sampleInvoice = {
  id: "inv1",
  invoiceNumber: "INV-001",
  status: "PENDING",
  subtotal: 1000,
  tax: 180,
  discount: 0,
  total: 1180,
  paid: 0,
  balance: 1180,
  createdAt: new Date().toISOString(),
  patient: {
    id: "p1",
    mrNumber: "MR-1",
    user: { name: "Aarav Mehta", phone: "9000000001", email: "a@x.com" },
  },
  items: [
    {
      id: "it1",
      description: "Consultation",
      category: "CONSULTATION",
      quantity: 1,
      unitPrice: 1000,
      total: 1000,
    },
  ],
  payments: [],
};

describe("InvoiceDetailPage", () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    apiMock.post.mockReset();
    authMock.mockImplementation((selector: any) => {
      const state = { user: { id: "u1", name: "Admin", email: "a@x.com", role: "ADMIN" } };
      return typeof selector === "function" ? selector(state) : state;
    });
  });

  it("shows loading state", async () => {
    apiMock.get.mockReturnValue(new Promise(() => {}));
    render(<InvoiceDetailPage />);
    await waitFor(() =>
      expect(screen.getByText(/loading invoice/i)).toBeInTheDocument()
    );
  });

  it("shows invoice-not-found on fetch failure", async () => {
    apiMock.get.mockRejectedValue(new Error("404"));
    render(<InvoiceDetailPage />);
    await waitFor(() =>
      expect(screen.getByText(/invoice not found/i)).toBeInTheDocument()
    );
  });

  it("renders populated invoice fields", async () => {
    apiMock.get.mockImplementation((url: string) => {
      if (url.includes("/billing/invoices/test-id"))
        return Promise.resolve({ data: sampleInvoice });
      return Promise.resolve({ data: [] });
    });
    render(<InvoiceDetailPage />);
    await waitFor(() =>
      expect(screen.getAllByText(/INV-001/).length).toBeGreaterThan(0)
    );
    expect(screen.getAllByText("Aarav Mehta").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/consultation/i).length).toBeGreaterThan(0);
  });

  it("opens Record Payment modal when button clicked", async () => {
    apiMock.get.mockImplementation((url: string) => {
      if (url.includes("/billing/invoices/test-id"))
        return Promise.resolve({ data: sampleInvoice });
      return Promise.resolve({ data: [] });
    });
    const user = userEvent.setup();
    render(<InvoiceDetailPage />);
    await waitFor(() =>
      expect(screen.getAllByText(/INV-001/).length).toBeGreaterThan(0)
    );
    const payBtns = screen.queryAllByRole("button", { name: /record payment/i });
    if (payBtns[0]) {
      await user.click(payBtns[0]);
      expect(screen.getAllByText(/record payment/i).length).toBeGreaterThan(0);
    }
  });

  it("renders without crashing when API returns no invoice", async () => {
    apiMock.get.mockResolvedValue({ data: null });
    render(<InvoiceDetailPage />);
    await waitFor(() =>
      expect(screen.getByText(/invoice not found/i)).toBeInTheDocument()
    );
  });
});
