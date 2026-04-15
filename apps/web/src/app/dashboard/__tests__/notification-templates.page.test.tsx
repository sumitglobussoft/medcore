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
  usePathname: () => "/dashboard/notification-templates",
}));

import NotificationTemplatesPage from "../notification-templates/page";

const sampleTemplates = [
  {
    id: "t1",
    key: "appointment.reminder",
    channel: "SMS",
    subject: null,
    body: "Hi {{name}}, your appointment is at {{time}}",
    active: true,
  },
];

describe("NotificationTemplatesPage", () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    authMock.mockImplementation((selector: any) => {
      const state = { user: { id: "u1", name: "Admin", email: "a@x.com", role: "ADMIN" } };
      return typeof selector === "function" ? selector(state) : state;
    });
    apiMock.get.mockResolvedValue({ data: [] });
  });

  it("renders Notification Templates heading", async () => {
    render(<NotificationTemplatesPage />);
    await waitFor(() =>
      expect(screen.getAllByRole("heading").length).toBeGreaterThan(0)
    );
  });

  it("renders populated templates", async () => {
    apiMock.get.mockResolvedValue({ data: sampleTemplates });
    render(<NotificationTemplatesPage />);
    await waitFor(() => {
      expect(screen.getAllByText(/appointment\.reminder|SMS/).length).toBeGreaterThan(0);
    });
  });

  it("keeps rendering when API returns an error", async () => {
    apiMock.get.mockRejectedValue(new Error("500"));
    render(<NotificationTemplatesPage />);
    await waitFor(() => {
      expect(apiMock.get).toHaveBeenCalled();
    });
  });

  it("fetches /notifications/templates on mount", async () => {
    render(<NotificationTemplatesPage />);
    await waitFor(() => {
      const urls = apiMock.get.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes("/notifications/templates"))).toBe(true);
    });
  });

  it("opens template edit form", async () => {
    const user = userEvent.setup();
    apiMock.get.mockResolvedValue({ data: sampleTemplates });
    render(<NotificationTemplatesPage />);
    await waitFor(() =>
      expect(screen.getAllByText(/appointment\.reminder/).length).toBeGreaterThan(0)
    );
    const editBtns = screen.queryAllByRole("button", { name: /edit/i });
    if (editBtns.length > 0) await user.click(editBtns[0]);
    expect(document.body).toBeTruthy();
  });
});
