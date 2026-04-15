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
  usePathname: () => "/dashboard/pediatric",
}));

import PediatricPage from "../pediatric/page";

const samplePeds = [
  {
    id: "p1",
    mrNumber: "MR-1",
    gender: "MALE",
    age: 5,
    user: { name: "Tiny Tim", phone: "9000000001" },
  },
  {
    id: "p2",
    mrNumber: "MR-2",
    gender: "FEMALE",
    age: 30,
    user: { name: "Big Sis", phone: "9000000002" },
  },
];

describe("PediatricPage", () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    authMock.mockImplementation((selector: any) => {
      const state = { user: { id: "u1", name: "Doc", email: "d@x.com", role: "DOCTOR" } };
      return typeof selector === "function" ? selector(state) : state;
    });
  });

  it("renders heading with empty data", async () => {
    apiMock.get.mockResolvedValue({ data: [] });
    render(<PediatricPage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /pediatric patients/i })).toBeInTheDocument()
    );
  });

  it("renders only patients under 18", async () => {
    apiMock.get.mockResolvedValue({ data: samplePeds });
    render(<PediatricPage />);
    await waitFor(() =>
      expect(screen.getAllByText(/Tiny Tim/).length).toBeGreaterThan(0)
    );
    expect(screen.queryByText(/Big Sis/)).toBeNull();
  });

  it("keeps rendering when API rejects", async () => {
    apiMock.get.mockRejectedValue(new Error("500"));
    render(<PediatricPage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /pediatric patients/i })).toBeInTheDocument()
    );
  });

  it("typing in search refetches", async () => {
    apiMock.get.mockResolvedValue({ data: [] });
    const user = userEvent.setup();
    render(<PediatricPage />);
    await waitFor(() =>
      screen.getByPlaceholderText(/search by name/i)
    );
    const input = screen.getByPlaceholderText(/search by name/i);
    await user.type(input, "tim");
    await waitFor(() => {
      const urls = apiMock.get.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes("search="))).toBe(true);
    });
  });

  it("shows empty state when no pediatric patients", async () => {
    apiMock.get.mockResolvedValue({ data: [] });
    render(<PediatricPage />);
    await waitFor(() =>
      expect(screen.getByText(/no pediatric patients/i)).toBeInTheDocument()
    );
  });
});
