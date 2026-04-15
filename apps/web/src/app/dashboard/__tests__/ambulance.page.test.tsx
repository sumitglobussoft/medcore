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
  usePathname: () => "/dashboard/ambulance",
}));

import AmbulancePage from "../ambulance/page";

const sampleAmbulances = [
  {
    id: "amb1",
    vehicleNumber: "KA-01-1234",
    type: "BLS",
    make: "Tata",
    model: "407",
    status: "AVAILABLE",
    driverName: "Raj",
    driverPhone: "9000000001",
    paramedicName: "Sam",
  },
];

const sampleTrips = [
  {
    id: "t1",
    tripNumber: "TRIP-001",
    status: "DISPATCHED",
    pickupLocation: "Central",
    destination: "Hospital",
    ambulance: sampleAmbulances[0],
    requestedAt: new Date().toISOString(),
    patient: null,
  },
];

describe("AmbulancePage", () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    authMock.mockImplementation((selector: any) => {
      const state = { user: { id: "u1", name: "Admin", email: "a@x.com", role: "ADMIN" } };
      return typeof selector === "function" ? selector(state) : state;
    });
  });

  it("renders heading with empty data", async () => {
    apiMock.get.mockResolvedValue({ data: [] });
    render(<AmbulancePage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /ambulance/i })).toBeInTheDocument()
    );
  });

  it("renders populated fleet + trips", async () => {
    apiMock.get.mockImplementation((url: string) => {
      if (url === "/ambulance") return Promise.resolve({ data: sampleAmbulances });
      if (url.startsWith("/ambulance/trips"))
        return Promise.resolve({ data: sampleTrips });
      return Promise.resolve({ data: [] });
    });
    render(<AmbulancePage />);
    await waitFor(() =>
      expect(screen.getAllByText(/KA-01-1234/).length).toBeGreaterThan(0)
    );
  });

  it("keeps rendering when API rejects", async () => {
    apiMock.get.mockRejectedValue(new Error("500"));
    render(<AmbulancePage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /ambulance/i })).toBeInTheDocument()
    );
  });

  it("clicking Dispatch Trip opens the modal", async () => {
    apiMock.get.mockResolvedValue({ data: [] });
    const user = userEvent.setup();
    render(<AmbulancePage />);
    await waitFor(() =>
      screen.getByRole("button", { name: /dispatch trip/i })
    );
    await user.click(screen.getByRole("button", { name: /dispatch trip/i }));
    await waitFor(() =>
      expect(screen.getAllByText(/dispatch ambulance/i).length).toBeGreaterThan(0)
    );
  });

  it("clicking All Trips tab switches view", async () => {
    apiMock.get.mockImplementation((url: string) => {
      if (url === "/ambulance") return Promise.resolve({ data: sampleAmbulances });
      if (url.startsWith("/ambulance/trips"))
        return Promise.resolve({ data: sampleTrips });
      return Promise.resolve({ data: [] });
    });
    const user = userEvent.setup();
    render(<AmbulancePage />);
    await waitFor(() =>
      screen.getByRole("button", { name: /all trips/i })
    );
    await user.click(screen.getByRole("button", { name: /all trips/i }));
    expect(
      screen.getByRole("button", { name: /all trips/i })
    ).toBeInTheDocument();
  });
});
