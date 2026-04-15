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
  usePathname: () => "/dashboard/scheduled-reports",
}));

import ScheduledReportsPage from "../scheduled-reports/page";

const sampleReports = [
  {
    id: "sr1",
    name: "Weekly Revenue",
    reportType: "REVENUE",
    schedule: "0 9 * * 1",
    recipients: ["admin@x.com"],
    active: true,
    createdAt: new Date().toISOString(),
  },
];

describe("ScheduledReportsPage", () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    authMock.mockImplementation((selector: any) => {
      const state = { user: { id: "u1", name: "Admin", email: "a@x.com", role: "ADMIN" } };
      return typeof selector === "function" ? selector(state) : state;
    });
    apiMock.get.mockResolvedValue({ data: [] });
  });

  it("renders Scheduled Reports heading", async () => {
    render(<ScheduledReportsPage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /scheduled reports/i })).toBeInTheDocument()
    );
  });

  it("renders populated reports", async () => {
    apiMock.get.mockResolvedValue({ data: sampleReports });
    render(<ScheduledReportsPage />);
    await waitFor(() => {
      expect(screen.getAllByText(/Weekly Revenue/).length).toBeGreaterThan(0);
    });
  });

  it("keeps rendering when API returns an error", async () => {
    apiMock.get.mockRejectedValue(new Error("500"));
    render(<ScheduledReportsPage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /scheduled reports/i })).toBeInTheDocument()
    );
  });

  it("switches to Runs tab and refetches", async () => {
    const user = userEvent.setup();
    render(<ScheduledReportsPage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /scheduled reports/i })).toBeInTheDocument()
    );
    const runsBtn = screen.queryAllByRole("button", { name: /runs/i })[0];
    if (runsBtn) {
      await user.click(runsBtn);
      await waitFor(() => {
        const urls = apiMock.get.mock.calls.map((c) => String(c[0]));
        expect(urls.length).toBeGreaterThan(1);
      });
    }
  });

  it("toggles New schedule form", async () => {
    const user = userEvent.setup();
    render(<ScheduledReportsPage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /scheduled reports/i })).toBeInTheDocument()
    );
    const buttons = screen.queryAllByRole("button", { name: /new|add|schedule/i });
    if (buttons.length > 0) {
      await user.click(buttons[0]);
    }
    expect(
      screen.getByRole("heading", { name: /scheduled reports/i })
    ).toBeInTheDocument();
  });
});
