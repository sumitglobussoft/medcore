/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Issue #170 (Apr 2026): Pediatric patient detail page used to crash with
 * "TypeError: r is not iterable" when /growth or /milestones returned a
 * payload with `data` undefined or non-array. This regression test mounts
 * the page with deliberately malformed responses and asserts that:
 *   - the page does NOT throw,
 *   - the patient header still renders (proving the patient request
 *     succeeded even when sibling endpoints failed/returned junk).
 */
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
  useParams: () => ({ patientId: "ped-uuid-1" }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/dashboard/pediatric/ped-uuid-1",
}));

import PediatricDetailPage from "./page";

const patient = {
  id: "ped-uuid-1",
  mrNumber: "MR000099",
  dateOfBirth: "2025-01-15",
  age: 1,
  gender: "MALE",
  user: { name: "Baby Sharma", phone: "9876543210" },
};

describe("PediatricDetailPage — Issue #170 array-coerce defense", () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    authMock.mockReturnValue({ user: { role: "DOCTOR" } });
  });

  it("does not crash when /growth returns data: undefined", async () => {
    apiMock.get.mockImplementation((endpoint: string) => {
      if (endpoint.startsWith("/patients/")) {
        return Promise.resolve({ success: true, data: patient });
      }
      if (endpoint.includes("/growth/patient/") && !endpoint.includes("/")) {
        return Promise.resolve({ success: true, data: undefined });
      }
      // Catch-all empty so feeding/milestones/ftt-check don't reject.
      return Promise.resolve({ success: true, data: undefined });
    });

    render(<PediatricDetailPage />);
    // Header renders (no crash).
    await waitFor(() =>
      expect(screen.getByText(/Baby Sharma/)).toBeInTheDocument()
    );
    // Empty-state placeholder for growth records visible.
    expect(
      screen.getByText(/No measurements recorded yet\./i)
    ).toBeInTheDocument();
  });

  it("does not crash when /growth returns null instead of array", async () => {
    apiMock.get.mockImplementation((endpoint: string) => {
      if (endpoint.startsWith("/patients/")) {
        return Promise.resolve({ success: true, data: patient });
      }
      // Any non-array shape — coerced to []
      return Promise.resolve({ success: true, data: null });
    });

    render(<PediatricDetailPage />);
    await waitFor(() =>
      expect(screen.getByText(/Baby Sharma/)).toBeInTheDocument()
    );
  });

  it("does not crash when /growth rejects (503-style)", async () => {
    apiMock.get.mockImplementation((endpoint: string) => {
      if (endpoint.startsWith("/patients/")) {
        return Promise.resolve({ success: true, data: patient });
      }
      return Promise.reject(new Error("503 Service Unavailable"));
    });

    render(<PediatricDetailPage />);
    // Patient header still renders even though every other call failed.
    await waitFor(() =>
      expect(screen.getByText(/Baby Sharma/)).toBeInTheDocument()
    );
  });

  it("renders growth rows when /growth returns a valid array", async () => {
    apiMock.get.mockImplementation((endpoint: string) => {
      if (endpoint.startsWith("/patients/")) {
        return Promise.resolve({ success: true, data: patient });
      }
      if (
        endpoint.startsWith("/growth/patient/ped-uuid-1") &&
        !endpoint.includes("milestones") &&
        !endpoint.includes("feeding") &&
        !endpoint.includes("ftt")
      ) {
        return Promise.resolve({
          success: true,
          data: [
            {
              id: "g1",
              measurementDate: "2026-04-01",
              ageMonths: 15,
              weightKg: 9.4,
              heightCm: 76,
              headCircumference: 46,
              bmi: 16.3,
              weightPercentile: 50,
              heightPercentile: 55,
            },
          ],
        });
      }
      return Promise.resolve({ success: true, data: { logs: [], daily: [], diff: [] } });
    });

    render(<PediatricDetailPage />);
    await waitFor(() =>
      expect(screen.getByText(/Baby Sharma/)).toBeInTheDocument()
    );
    // Growth row visible (76 cm height appears in the table cell).
    await waitFor(() =>
      expect(screen.getByText(/9\.4 kg/)).toBeInTheDocument()
    );
  });
});
