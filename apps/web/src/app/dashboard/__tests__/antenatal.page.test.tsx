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
  usePathname: () => "/dashboard/antenatal",
}));

import AntenatalPage from "../antenatal/page";

const sampleCases = [
  {
    id: "anc1",
    caseNumber: "ANC-001",
    lmpDate: new Date(Date.now() - 86_400_000 * 100).toISOString(),
    eddDate: new Date(Date.now() + 86_400_000 * 180).toISOString(),
    gravida: 1,
    parity: 0,
    isHighRisk: false,
    deliveredAt: null,
    patient: { id: "p1", mrNumber: "MR-1", user: { name: "Bina Shah" } },
    doctor: { id: "d1", user: { name: "Dr. Rao" } },
  },
];

describe("AntenatalPage", () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    apiMock.post.mockReset();
    authMock.mockImplementation((selector: any) => {
      const state = { user: { id: "u1", name: "Doc", email: "d@x.com", role: "DOCTOR" } };
      return typeof selector === "function" ? selector(state) : state;
    });
  });

  it("renders heading with empty data", async () => {
    apiMock.get.mockResolvedValue({ data: [] });
    render(<AntenatalPage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /antenatal care/i })).toBeInTheDocument()
    );
  });

  it("renders populated cases", async () => {
    apiMock.get.mockImplementation((url: string) => {
      if (url.startsWith("/antenatal/cases"))
        return Promise.resolve({ data: sampleCases });
      if (url.startsWith("/antenatal/dashboard"))
        return Promise.resolve({ data: { active: 1, highRisk: 0, delivered: 0, upcomingDeliveries: 0 } });
      return Promise.resolve({ data: [] });
    });
    render(<AntenatalPage />);
    await waitFor(() =>
      expect(screen.getAllByText("Bina Shah").length).toBeGreaterThan(0)
    );
  });

  it("keeps rendering when API rejects", async () => {
    apiMock.get.mockRejectedValue(new Error("500"));
    render(<AntenatalPage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /antenatal care/i })).toBeInTheDocument()
    );
  });

  it("clicking New ANC Case opens modal", async () => {
    apiMock.get.mockResolvedValue({ data: [] });
    const user = userEvent.setup();
    render(<AntenatalPage />);
    await waitFor(() =>
      screen.getByRole("button", { name: /new anc case/i })
    );
    await user.click(screen.getByRole("button", { name: /new anc case/i }));
    await waitFor(() =>
      expect(screen.getByText(/new antenatal case/i)).toBeInTheDocument()
    );
  });

  it("switches to High Risk tab", async () => {
    apiMock.get.mockResolvedValue({ data: [] });
    const user = userEvent.setup();
    render(<AntenatalPage />);
    await waitFor(() =>
      screen.getByRole("button", { name: /high risk/i })
    );
    await user.click(screen.getByRole("button", { name: /high risk/i }));
    await waitFor(() => {
      const urls = apiMock.get.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes("isHighRisk=true"))).toBe(true);
    });
  });
});
