/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { apiMock, authMock, toastMock, socketMock } = vi.hoisted(() => ({
  apiMock: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  authMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  socketMock: { connect: vi.fn(), disconnect: vi.fn(), emit: vi.fn(), on: vi.fn(), off: vi.fn(), connected: false },
}));

vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/lib/store", () => ({ useAuthStore: authMock }));
vi.mock("@/lib/toast", () => ({ toast: toastMock }));
vi.mock("@/lib/socket", () => ({ getSocket: () => socketMock }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/dashboard/wards",
}));

import WardsPage from "../wards/page";

const sampleWards = [
  {
    id: "w1",
    name: "General Ward",
    type: "GENERAL",
    floor: "1",
    totalBeds: 10,
    availableBeds: 6,
    occupiedBeds: 3,
    cleaningBeds: 1,
    maintenanceBeds: 0,
    beds: [],
  },
];

describe("WardsPage", () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    authMock.mockImplementation((selector: any) => {
      const state = { user: { id: "u1", name: "Admin", email: "a@x.com", role: "ADMIN" } };
      return typeof selector === "function" ? selector(state) : state;
    });
    apiMock.get.mockResolvedValue({ data: [] });
  });

  it("renders Wards heading with empty data", async () => {
    render(<WardsPage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /wards/i })).toBeInTheDocument()
    );
  });

  it("renders populated ward list", async () => {
    apiMock.get.mockResolvedValue({ data: sampleWards });
    render(<WardsPage />);
    await waitFor(() => {
      expect(screen.getAllByText(/General Ward/).length).toBeGreaterThan(0);
    });
  });

  it("shows loading state while fetching", async () => {
    let resolve: (v: any) => void = () => {};
    apiMock.get.mockImplementation(() => new Promise((r) => { resolve = r; }));
    render(<WardsPage />);
    expect(await screen.findByText(/loading/i)).toBeInTheDocument();
    resolve({ data: [] });
  });

  it("keeps rendering when API returns an error", async () => {
    apiMock.get.mockRejectedValue(new Error("500"));
    render(<WardsPage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /wards/i })).toBeInTheDocument()
    );
  });

  it("fetches /wards endpoint on mount", async () => {
    render(<WardsPage />);
    await waitFor(() => {
      const urls = apiMock.get.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes("/wards"))).toBe(true);
    });
  });
});
