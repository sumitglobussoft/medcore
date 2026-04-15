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
  usePathname: () => "/dashboard/surgery",
}));

import SurgeryPage from "../surgery/page";

const sampleSurgeries = [
  {
    id: "s1",
    caseNumber: "SG-001",
    procedure: "Appendectomy",
    scheduledAt: new Date().toISOString(),
    status: "SCHEDULED",
    patient: { user: { name: "Asha Roy" } },
    surgeon: { user: { name: "Dr. Singh" } },
    ot: { id: "ot1", name: "OT-1" },
  },
];

describe("SurgeryPage", () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    authMock.mockImplementation((selector: any) => {
      const state = { user: { id: "u1", name: "Dr", email: "d@x.com", role: "DOCTOR" } };
      return typeof selector === "function" ? selector(state) : state;
    });
    apiMock.get.mockResolvedValue({ data: [] });
  });

  it("renders Surgery heading with empty data", async () => {
    render(<SurgeryPage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /^surgery$/i })).toBeInTheDocument()
    );
  });

  it("renders populated surgeries", async () => {
    apiMock.get.mockResolvedValue({ data: sampleSurgeries });
    render(<SurgeryPage />);
    await waitFor(() => {
      expect(screen.getAllByText(/SG-001|Appendectomy|Asha Roy/).length).toBeGreaterThan(0);
    });
  });

  it("switches tabs and refetches", async () => {
    const user = userEvent.setup();
    render(<SurgeryPage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /^surgery$/i })).toBeInTheDocument()
    );
    await user.click(screen.getByRole("button", { name: /completed/i }));
    await waitFor(() => {
      const urls = apiMock.get.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes("COMPLETED"))).toBe(true);
    });
  });

  it("keeps rendering when API returns an error", async () => {
    apiMock.get.mockRejectedValue(new Error("500"));
    render(<SurgeryPage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /^surgery$/i })).toBeInTheDocument()
    );
  });

  it("shows Schedule button for DOCTOR role", async () => {
    render(<SurgeryPage />);
    await waitFor(() => {
      const btns = screen.queryAllByRole("button", { name: /schedule|new surgery|create/i });
      expect(btns.length).toBeGreaterThan(0);
    });
  });
});
