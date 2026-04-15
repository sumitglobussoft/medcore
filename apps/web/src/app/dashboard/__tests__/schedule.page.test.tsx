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
  usePathname: () => "/dashboard/schedule",
}));

import SchedulePage from "../schedule/page";

describe("SchedulePage", () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    authMock.mockImplementation((selector: any) => {
      const state = { user: { id: "u1", name: "Admin", email: "a@x.com", role: "ADMIN" } };
      return typeof selector === "function" ? selector(state) : state;
    });
    apiMock.get.mockResolvedValue({ data: [] });
  });

  it("renders Schedule Management heading", async () => {
    render(<SchedulePage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /schedule management/i })).toBeInTheDocument()
    );
  });

  it("fetches doctors on mount", async () => {
    render(<SchedulePage />);
    await waitFor(() => {
      const urls = apiMock.get.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes("/doctors"))).toBe(true);
    });
  });

  it("renders doctor options when data returned", async () => {
    apiMock.get.mockImplementation((url: string) => {
      if (url.includes("/doctors") && !url.includes("/schedule"))
        return Promise.resolve({
          data: [{ id: "d1", user: { name: "Dr. Singh" }, specialization: "GP" }],
        });
      return Promise.resolve({ data: [] });
    });
    render(<SchedulePage />);
    await waitFor(() => {
      expect(screen.getAllByText(/Dr\. Singh/).length).toBeGreaterThan(0);
    });
  });

  it("keeps rendering when API returns an error", async () => {
    apiMock.get.mockRejectedValue(new Error("500"));
    render(<SchedulePage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /schedule management/i })).toBeInTheDocument()
    );
  });

  it("shows schedule/override action buttons for ADMIN", async () => {
    render(<SchedulePage />);
    await waitFor(() => {
      const btns = screen.queryAllByRole("button");
      expect(btns.length).toBeGreaterThan(0);
    });
  });
});
