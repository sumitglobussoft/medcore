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

vi.mock("@/lib/api", () => ({ api: apiMock, openPrintEndpoint: vi.fn() }));
vi.mock("@/lib/store", () => ({ useAuthStore: authMock }));
vi.mock("@/lib/toast", () => ({ toast: toastMock }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/dashboard/prescriptions",
}));

import PrescriptionsPage from "../prescriptions/page";

const sampleRx = [
  {
    id: "rx1",
    createdAt: new Date().toISOString(),
    printed: false,
    patient: { id: "p1", mrNumber: "MR-1", user: { name: "Asha Roy" } },
    doctor: { id: "d1", user: { name: "Dr. Singh" } },
    medicines: [{ medicineName: "Paracetamol", dosage: "500mg", frequency: "BID", duration: "5d" }],
    diagnosis: "Fever",
    advice: "Rest",
  },
  {
    id: "rx2",
    createdAt: new Date().toISOString(),
    printed: true,
    patient: { id: "p2", mrNumber: "MR-2", user: { name: "Bhuvan Das" } },
    doctor: { id: "d1", user: { name: "Dr. Singh" } },
    medicines: [{ medicineName: "Ibuprofen", dosage: "400mg", frequency: "TID", duration: "3d" }],
    diagnosis: "Pain",
    advice: "",
  },
];

describe("PrescriptionsPage", () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    apiMock.post.mockReset();
    authMock.mockImplementation((selector: any) => {
      const state = { user: { id: "u1", name: "Dr", email: "d@x.com", role: "DOCTOR" } };
      return typeof selector === "function" ? selector(state) : state;
    });
    apiMock.get.mockResolvedValue({ data: [] });
  });

  it("renders Prescriptions heading with empty data", async () => {
    render(<PrescriptionsPage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /prescriptions/i })).toBeInTheDocument()
    );
  });

  it("renders populated prescription rows", async () => {
    apiMock.get.mockResolvedValue({ data: sampleRx });
    render(<PrescriptionsPage />);
    await waitFor(() => {
      expect(screen.getAllByText(/Asha Roy/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Bhuvan Das/).length).toBeGreaterThan(0);
    });
  });

  it("shows Write prescription button for DOCTOR", async () => {
    render(<PrescriptionsPage />);
    await waitFor(() => {
      expect(
        screen.getAllByRole("button", { name: /write prescription|new prescription/i }).length
      ).toBeGreaterThan(0);
    });
  });

  it("opens prescription form when Write prescription is clicked", async () => {
    const user = userEvent.setup();
    render(<PrescriptionsPage />);
    await waitFor(() =>
      screen.getAllByRole("button", { name: /write prescription|new prescription/i })[0]
    );
    const btns = screen.getAllByRole("button", { name: /write prescription|new prescription/i });
    await user.click(btns[0]);
    await waitFor(() => {
      expect(screen.getAllByPlaceholderText(/medicine name|patient id|appointment id/i).length).toBeGreaterThan(0);
    });
  });

  it("keeps rendering when API returns an error", async () => {
    apiMock.get.mockRejectedValue(new Error("500"));
    render(<PrescriptionsPage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /prescriptions/i })).toBeInTheDocument()
    );
  });
});
