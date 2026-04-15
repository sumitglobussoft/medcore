/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { apiMock, authMock } = vi.hoisted(() => ({
  apiMock: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  authMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/lib/store", () => ({ useAuthStore: authMock }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/dashboard/expenses",
}));

import ExpensesPage from "../expenses/page";

const sampleExpenses = [
  {
    id: "e1",
    description: "Electricity bill",
    category: "UTILITIES",
    amount: 5000,
    spentOn: new Date().toISOString(),
    notes: "",
  },
];

const sampleSummary = {
  grandTotal: 5000,
  transactionCount: 1,
  byCategory: [{ category: "UTILITIES", total: 5000, count: 1 }],
};

describe("ExpensesPage", () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    apiMock.post.mockReset();
    apiMock.delete.mockReset();
    authMock.mockImplementation((selector: any) => {
      const state = { user: { id: "u1", name: "Admin", email: "a@x.com", role: "ADMIN" } };
      return typeof selector === "function" ? selector(state) : state;
    });
  });

  it("renders heading with empty data", async () => {
    apiMock.get.mockResolvedValue({ data: { grandTotal: 0, transactionCount: 0, byCategory: [] } });
    apiMock.get.mockResolvedValueOnce({ data: [] });
    render(<ExpensesPage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /expenses/i })).toBeInTheDocument()
    );
  });

  it("renders populated summary + expenses", async () => {
    apiMock.get.mockImplementation((url: string) => {
      if (url.startsWith("/expenses/summary"))
        return Promise.resolve({ data: sampleSummary });
      if (url.startsWith("/expenses"))
        return Promise.resolve({ data: sampleExpenses });
      return Promise.resolve({ data: [] });
    });
    render(<ExpensesPage />);
    await waitFor(() =>
      expect(screen.getAllByText(/electricity bill/i).length).toBeGreaterThan(0)
    );
  });

  it("keeps rendering when API rejects", async () => {
    apiMock.get.mockRejectedValue(new Error("500"));
    render(<ExpensesPage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /expenses/i })).toBeInTheDocument()
    );
  });

  it("clicking Add Expense opens modal", async () => {
    apiMock.get.mockImplementation((url: string) => {
      if (url.startsWith("/expenses/summary"))
        return Promise.resolve({ data: sampleSummary });
      return Promise.resolve({ data: [] });
    });
    const user = userEvent.setup();
    render(<ExpensesPage />);
    await waitFor(() =>
      screen.getByRole("button", { name: /add expense/i })
    );
    await user.click(screen.getByRole("button", { name: /add expense/i }));
    await waitFor(() =>
      expect(screen.getAllByText(/add expense/i).length).toBeGreaterThan(1)
    );
  });

  it("shows Rs. total in summary", async () => {
    apiMock.get.mockImplementation((url: string) => {
      if (url.startsWith("/expenses/summary"))
        return Promise.resolve({ data: sampleSummary });
      return Promise.resolve({ data: sampleExpenses });
    });
    render(<ExpensesPage />);
    await waitFor(() =>
      expect(screen.getAllByText(/Rs\./).length).toBeGreaterThan(0)
    );
  });
});
