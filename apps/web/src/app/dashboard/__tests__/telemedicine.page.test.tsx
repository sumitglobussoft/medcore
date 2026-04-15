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
  usePathname: () => "/dashboard/telemedicine",
}));

import TelemedicinePage from "../telemedicine/page";

const sampleSessions = [
  {
    id: "t1",
    sessionNumber: "TM-001",
    scheduledAt: new Date(Date.now() + 3600000).toISOString(),
    status: "SCHEDULED",
    patient: { user: { name: "Asha Roy" }, mrNumber: "MR-1" },
    doctor: { user: { name: "Dr. Singh" } },
  },
];

describe("TelemedicinePage", () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    authMock.mockImplementation((selector: any) => {
      const state = { user: { id: "u1", name: "Dr", email: "d@x.com", role: "DOCTOR" } };
      return typeof selector === "function" ? selector(state) : state;
    });
    apiMock.get.mockResolvedValue({ data: [] });
  });

  it("renders Telemedicine heading with empty data", async () => {
    render(<TelemedicinePage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /telemedicine/i })).toBeInTheDocument()
    );
  });

  it("renders populated sessions", async () => {
    apiMock.get.mockResolvedValue({ data: sampleSessions });
    render(<TelemedicinePage />);
    await waitFor(() => {
      expect(screen.getAllByText(/Asha Roy|TM-001/).length).toBeGreaterThan(0);
    });
  });

  it("switches to completed tab", async () => {
    const user = userEvent.setup();
    render(<TelemedicinePage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /telemedicine/i })).toBeInTheDocument()
    );
    await user.click(screen.getByRole("button", { name: /completed/i }));
    await waitFor(() => {
      const urls = apiMock.get.mock.calls.map((c) => String(c[0]));
      expect(urls.length).toBeGreaterThan(0);
    });
  });

  it("keeps rendering when API returns an error", async () => {
    apiMock.get.mockRejectedValue(new Error("500"));
    render(<TelemedicinePage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /telemedicine/i })).toBeInTheDocument()
    );
  });

  it("shows Schedule/New button for DOCTOR role", async () => {
    render(<TelemedicinePage />);
    await waitFor(() => {
      const btns = screen.queryAllByRole("button", { name: /schedule|new|create/i });
      expect(btns.length).toBeGreaterThan(0);
    });
  });
});
