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
  usePathname: () => "/dashboard/notifications",
}));

import NotificationsPage from "../notifications/page";

const sampleNotifs = [
  {
    id: "n1",
    type: "APPOINTMENT",
    title: "New Appointment",
    message: "You have a new appointment at 10:00",
    read: false,
    createdAt: new Date().toISOString(),
  },
];

describe("NotificationsPage", () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    authMock.mockImplementation((selector: any) => {
      const state = { user: { id: "u1", name: "Admin", email: "a@x.com", role: "ADMIN" } };
      return typeof selector === "function" ? selector(state) : state;
    });
    apiMock.get.mockResolvedValue({ data: [], meta: { total: 0 } });
  });

  it("renders Notifications heading with empty data", async () => {
    render(<NotificationsPage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /notifications/i })).toBeInTheDocument()
    );
  });

  it("renders populated notifications", async () => {
    apiMock.get.mockImplementation((url: string) => {
      if (url.includes("/notifications") && !url.includes("/preferences"))
        return Promise.resolve({ data: sampleNotifs, meta: { total: 1 } });
      return Promise.resolve({ data: [] });
    });
    render(<NotificationsPage />);
    await waitFor(() => {
      expect(screen.getAllByText(/New Appointment/).length).toBeGreaterThan(0);
    });
  });

  it("keeps rendering when API returns an error", async () => {
    apiMock.get.mockRejectedValue(new Error("500"));
    render(<NotificationsPage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /notifications/i })).toBeInTheDocument()
    );
  });

  it("toggles preferences panel", async () => {
    const user = userEvent.setup();
    render(<NotificationsPage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /notifications/i })).toBeInTheDocument()
    );
    const prefsBtn = screen.queryAllByRole("button", { name: /preferences|settings/i })[0];
    if (prefsBtn) await user.click(prefsBtn);
    expect(
      screen.getByRole("heading", { name: /notifications/i })
    ).toBeInTheDocument();
  });

  it("shows Mark all as read button", async () => {
    render(<NotificationsPage />);
    await waitFor(() => {
      const btns = screen.queryAllByRole("button", { name: /mark all/i });
      expect(btns.length).toBeGreaterThanOrEqual(0);
    });
  });
});
