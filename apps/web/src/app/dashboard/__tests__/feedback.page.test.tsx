/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

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
  usePathname: () => "/dashboard/feedback",
}));

import FeedbackPage from "../feedback/page";

const sampleFeedback = [
  {
    id: "f1",
    rating: 5,
    comments: "Excellent service",
    category: "OPD",
    createdAt: new Date().toISOString(),
    patient: { user: { name: "Asha Roy" } },
  },
];

describe("FeedbackPage", () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    authMock.mockImplementation((selector: any) => {
      const state = { user: { id: "u1", name: "Admin", email: "a@x.com", role: "ADMIN" } };
      return typeof selector === "function" ? selector(state) : state;
    });
    apiMock.get.mockResolvedValue({ data: [] });
  });

  it("renders Patient Feedback heading", async () => {
    render(<FeedbackPage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /patient feedback/i })).toBeInTheDocument()
    );
  });

  it("renders populated feedback entries", async () => {
    apiMock.get.mockImplementation((url: string) => {
      if (url.includes("/feedback?")) return Promise.resolve({ data: sampleFeedback });
      return Promise.resolve({ data: { avgRating: 5, total: 1, byCategory: {} } });
    });
    render(<FeedbackPage />);
    await waitFor(() => {
      expect(screen.getAllByText(/Excellent service|Asha Roy/).length).toBeGreaterThan(0);
    });
  });

  it("keeps rendering when API returns an error", async () => {
    apiMock.get.mockRejectedValue(new Error("500"));
    render(<FeedbackPage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /patient feedback/i })).toBeInTheDocument()
    );
  });

  it("fetches feedback summary on mount", async () => {
    render(<FeedbackPage />);
    await waitFor(() => {
      const urls = apiMock.get.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes("/feedback"))).toBe(true);
    });
  });
});
