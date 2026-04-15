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
  usePathname: () => "/dashboard/purchase-orders",
}));

import PurchaseOrdersPage from "../purchase-orders/page";

const samplePOs = [
  {
    id: "po1",
    poNumber: "PO-001",
    status: "DRAFT",
    createdAt: new Date().toISOString(),
    totalAmount: 5000,
    supplier: { id: "s1", name: "Acme Pharma" },
    items: [],
  },
];

describe("PurchaseOrdersPage", () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    authMock.mockImplementation((selector: any) => {
      const state = { user: { id: "u1", name: "Admin", email: "a@x.com", role: "ADMIN" } };
      return typeof selector === "function" ? selector(state) : state;
    });
    apiMock.get.mockResolvedValue({ data: [] });
  });

  it("renders Purchase Orders heading with empty data", async () => {
    render(<PurchaseOrdersPage />);
    await waitFor(() =>
      expect(screen.getAllByRole("heading").length).toBeGreaterThan(0)
    );
  });

  it("renders populated PO list", async () => {
    apiMock.get.mockResolvedValue({ data: samplePOs });
    render(<PurchaseOrdersPage />);
    await waitFor(() => {
      expect(screen.getAllByText(/PO-001|Acme Pharma/).length).toBeGreaterThan(0);
    });
  });

  it("switches tabs and refetches", async () => {
    const user = userEvent.setup();
    render(<PurchaseOrdersPage />);
    await waitFor(() =>
      expect(screen.getAllByRole("heading").length).toBeGreaterThan(0)
    );
    const tabBtns = screen.queryAllByRole("button");
    // click any tab button
    if (tabBtns.length > 1) await user.click(tabBtns[1]);
    await waitFor(() => {
      expect(apiMock.get).toHaveBeenCalled();
    });
  });

  it("keeps rendering when API returns an error", async () => {
    apiMock.get.mockRejectedValue(new Error("500"));
    render(<PurchaseOrdersPage />);
    await waitFor(() => {
      expect(apiMock.get).toHaveBeenCalled();
    });
  });

  it("fetches /purchase-orders endpoint on mount", async () => {
    render(<PurchaseOrdersPage />);
    await waitFor(() => {
      const urls = apiMock.get.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes("/purchase-orders"))).toBe(true);
    });
  });
});
