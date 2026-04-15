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
  usePathname: () => "/dashboard/patients/test-id",
  useParams: () => ({ id: "test-id" }),
}));

import PatientDetailPage from "../patients/[id]/page";

const samplePatient = {
  id: "p1",
  mrNumber: "MR-1",
  gender: "MALE",
  age: 35,
  bloodGroup: "O+",
  dateOfBirth: "1990-01-01",
  user: { id: "u1", name: "Aarav Mehta", email: "a@x.com", phone: "9000000001" },
};

describe("PatientDetailPage", () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    authMock.mockImplementation((selector: any) => {
      const state = { user: { id: "u1", name: "Doc", email: "d@x.com", role: "DOCTOR" } };
      return typeof selector === "function" ? selector(state) : state;
    });
  });

  it("shows loading state", async () => {
    apiMock.get.mockReturnValue(new Promise(() => {}));
    render(<PatientDetailPage />);
    await waitFor(() =>
      expect(screen.getByText(/loading/i)).toBeInTheDocument()
    );
  });

  it("shows patient-not-found on failure", async () => {
    apiMock.get.mockRejectedValue(new Error("404"));
    render(<PatientDetailPage />);
    await waitFor(() =>
      expect(screen.getByText(/patient not found/i)).toBeInTheDocument()
    );
  });

  it("renders populated patient details", async () => {
    apiMock.get.mockImplementation((url: string) => {
      if (url === "/patients/test-id") return Promise.resolve({ data: samplePatient });
      return Promise.resolve({ data: [] });
    });
    render(<PatientDetailPage />);
    await waitFor(() =>
      expect(screen.getAllByText("Aarav Mehta").length).toBeGreaterThan(0)
    );
  });

  it("renders back link to Patients", async () => {
    apiMock.get.mockImplementation((url: string) => {
      if (url === "/patients/test-id") return Promise.resolve({ data: samplePatient });
      return Promise.resolve({ data: [] });
    });
    render(<PatientDetailPage />);
    await waitFor(() =>
      expect(screen.getByText(/back to patients/i)).toBeInTheDocument()
    );
  });

  it("renders MR number", async () => {
    apiMock.get.mockImplementation((url: string) => {
      if (url === "/patients/test-id") return Promise.resolve({ data: samplePatient });
      return Promise.resolve({ data: [] });
    });
    render(<PatientDetailPage />);
    await waitFor(() =>
      expect(screen.getAllByText(/MR-1/).length).toBeGreaterThan(0)
    );
  });
});
