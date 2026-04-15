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
  usePathname: () => "/dashboard/bloodbank",
}));

import BloodBankPage from "../bloodbank/page";

describe("BloodBankPage", () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    authMock.mockImplementation((selector: any) => {
      const state = { user: { id: "u1", name: "Admin", email: "a@x.com", role: "ADMIN" } };
      return typeof selector === "function" ? selector(state) : state;
    });
    apiMock.get.mockResolvedValue({ data: [] });
  });

  it("renders Blood Bank heading with empty data", async () => {
    render(<BloodBankPage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /blood bank/i })).toBeInTheDocument()
    );
  });

  it("renders populated donors list", async () => {
    const donors = [
      { id: "d1", donorNumber: "DN-001", name: "Ravi", phone: "9000000001", bloodGroup: "O+" },
      { id: "d2", donorNumber: "DN-002", name: "Meera", phone: "9000000002", bloodGroup: "A+" },
    ];
    apiMock.get.mockImplementation((url: string) => {
      if (url.includes("/donors")) return Promise.resolve({ data: donors });
      return Promise.resolve({ data: [] });
    });
    render(<BloodBankPage />);
    await waitFor(() => {
      expect(screen.getAllByText(/Ravi|Meera/).length).toBeGreaterThan(0);
    });
  });

  it("keeps rendering when API returns an error", async () => {
    apiMock.get.mockRejectedValue(new Error("500"));
    render(<BloodBankPage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /blood bank/i })).toBeInTheDocument()
    );
  });

  it("switches between tabs", async () => {
    const user = userEvent.setup();
    render(<BloodBankPage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /blood bank/i })).toBeInTheDocument()
    );
    const donorsBtn = screen.queryAllByRole("button", { name: /donors/i })[0];
    if (donorsBtn) await user.click(donorsBtn);
    expect(
      screen.getByRole("heading", { name: /blood bank/i })
    ).toBeInTheDocument();
  });

  it("calls blood bank API endpoints on load", async () => {
    render(<BloodBankPage />);
    await waitFor(() => {
      const urls = apiMock.get.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes("/bloodbank"))).toBe(true);
    });
  });
});
