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
  usePathname: () => "/dashboard/notifications/delivery",
}));

import NotificationDeliveryPage from "../notifications/delivery/page";

const sampleRows = [
  {
    id: "n1",
    type: "APPOINTMENT_REMINDER",
    channel: "WHATSAPP",
    title: "Reminder",
    message: "Your appt",
    deliveryStatus: "FAILED",
    failureReason: "Invalid number",
    sentAt: null,
    deliveredAt: null,
    readAt: null,
    createdAt: new Date().toISOString(),
    user: { id: "u2", name: "Aarav Mehta", email: "a@x.com", phone: "9000000001" },
  },
];

describe("NotificationDeliveryPage", () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    apiMock.post.mockReset();
    authMock.mockImplementation((selector: any) => {
      const state = { user: { id: "u1", name: "Admin", email: "a@x.com", role: "ADMIN" } };
      return typeof selector === "function" ? selector(state) : state;
    });
  });

  it("renders heading with empty data", async () => {
    apiMock.get.mockResolvedValue({ data: [] });
    render(<NotificationDeliveryPage />);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /notification delivery status/i })
      ).toBeInTheDocument()
    );
  });

  it("renders populated delivery rows", async () => {
    apiMock.get.mockResolvedValue({ data: sampleRows });
    render(<NotificationDeliveryPage />);
    await waitFor(() =>
      expect(screen.getAllByText("Aarav Mehta").length).toBeGreaterThan(0)
    );
    expect(screen.getAllByText(/FAILED/).length).toBeGreaterThan(0);
  });

  it("shows empty state message", async () => {
    apiMock.get.mockResolvedValue({ data: [] });
    render(<NotificationDeliveryPage />);
    await waitFor(() =>
      expect(screen.getByText(/no notifications match/i)).toBeInTheDocument()
    );
  });

  it("keeps rendering when API rejects", async () => {
    apiMock.get.mockRejectedValue(new Error("500"));
    render(<NotificationDeliveryPage />);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /notification delivery status/i })
      ).toBeInTheDocument()
    );
  });

  it("clicking Retry button on failed row calls retry API", async () => {
    apiMock.get.mockResolvedValue({ data: sampleRows });
    apiMock.post.mockResolvedValue({ data: {} });
    const user = userEvent.setup();
    render(<NotificationDeliveryPage />);
    await waitFor(() =>
      screen.getByRole("button", { name: /retry/i })
    );
    await user.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith("/notifications/n1/retry")
    );
  });
});
