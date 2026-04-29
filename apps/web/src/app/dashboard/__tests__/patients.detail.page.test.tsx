/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

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
    apiMock.patch.mockReset();
    apiMock.post.mockReset();
    apiMock.put.mockReset();
    apiMock.delete.mockReset();
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
      if (url.endsWith("/stats")) return Promise.reject(new Error("no stats"));
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
      if (url.endsWith("/stats")) return Promise.reject(new Error("no stats"));
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
      if (url.endsWith("/stats")) return Promise.reject(new Error("no stats"));
      return Promise.resolve({ data: [] });
    });
    render(<PatientDetailPage />);
    await waitFor(() =>
      expect(screen.getAllByText(/MR-1/).length).toBeGreaterThan(0)
    );
  });

  describe("Edit button (Issue #39)", () => {
    function mockPatientLoad() {
      apiMock.get.mockImplementation((url: string) => {
        if (url === "/patients/test-id")
          return Promise.resolve({ data: samplePatient });
        if (url.endsWith("/stats")) return Promise.reject(new Error("no stats"));
        return Promise.resolve({ data: [] });
      });
    }

    // Issue #185 (2026-04-29): Edit-Patient is now RECEPTION + ADMIN only.
    // DOCTOR / NURSE roles intentionally do NOT see the Edit button —
    // they record clinical data (notes, prescriptions, vitals), not patient
    // demographic data. The two assertions below are inversions of the
    // earlier behaviour.
    it("hides Edit button for DOCTOR (#185)", async () => {
      authMock.mockImplementation((selector: any) => {
        const state = {
          user: { id: "u1", name: "Doc", email: "d@x.com", role: "DOCTOR" },
        };
        return typeof selector === "function" ? selector(state) : state;
      });
      mockPatientLoad();
      render(<PatientDetailPage />);
      await waitFor(() =>
        expect(screen.getAllByText("Aarav Mehta").length).toBeGreaterThan(0),
      );
      expect(screen.queryByTestId("patient-edit-button")).toBeNull();
    });

    it("shows Edit button for ADMIN", async () => {
      authMock.mockImplementation((selector: any) => {
        const state = {
          user: { id: "u1", name: "Admin", email: "a@x.com", role: "ADMIN" },
        };
        return typeof selector === "function" ? selector(state) : state;
      });
      mockPatientLoad();
      render(<PatientDetailPage />);
      await waitFor(() =>
        expect(screen.getByTestId("patient-edit-button")).toBeInTheDocument()
      );
    });

    it("hides Edit button for NURSE (#185)", async () => {
      authMock.mockImplementation((selector: any) => {
        const state = {
          user: { id: "u1", name: "Nurse", email: "n@x.com", role: "NURSE" },
        };
        return typeof selector === "function" ? selector(state) : state;
      });
      mockPatientLoad();
      render(<PatientDetailPage />);
      await waitFor(() =>
        expect(screen.getAllByText("Aarav Mehta").length).toBeGreaterThan(0),
      );
      expect(screen.queryByTestId("patient-edit-button")).toBeNull();
    });

    it("shows Edit button for RECEPTION", async () => {
      authMock.mockImplementation((selector: any) => {
        const state = {
          user: {
            id: "u1",
            name: "Reception",
            email: "r@x.com",
            role: "RECEPTION",
          },
        };
        return typeof selector === "function" ? selector(state) : state;
      });
      mockPatientLoad();
      render(<PatientDetailPage />);
      await waitFor(() =>
        expect(screen.getByTestId("patient-edit-button")).toBeInTheDocument()
      );
    });

    it("hides Edit button for PATIENT role", async () => {
      authMock.mockImplementation((selector: any) => {
        const state = {
          user: {
            id: "u1",
            name: "Bob",
            email: "b@x.com",
            role: "PATIENT",
          },
        };
        return typeof selector === "function" ? selector(state) : state;
      });
      mockPatientLoad();
      render(<PatientDetailPage />);
      await waitFor(() =>
        expect(screen.getAllByText("Aarav Mehta").length).toBeGreaterThan(0)
      );
      expect(screen.queryByTestId("patient-edit-button")).toBeNull();
    });

    it("opens modal with read-only MR and submits PATCH preserving MR", async () => {
      authMock.mockImplementation((selector: any) => {
        const state = {
          // Issue #185: Edit is now RECEPTION/ADMIN only — was DOCTOR before
          user: { id: "u1", name: "Reception", email: "r@x.com", role: "RECEPTION" },
        };
        return typeof selector === "function" ? selector(state) : state;
      });
      mockPatientLoad();
      apiMock.patch.mockResolvedValue({
        data: { ...samplePatient, user: { ...samplePatient.user, name: "Aarav M" } },
      });

      render(<PatientDetailPage />);
      const btn = await screen.findByTestId("patient-edit-button");
      fireEvent.click(btn);

      const modal = await screen.findByTestId("patient-edit-modal");
      expect(modal).toBeInTheDocument();

      // MR field is read-only and has the existing value.
      const mr = screen.getByTestId("patient-edit-mrNumber") as HTMLInputElement;
      expect(mr.value).toBe("MR-1");
      expect(mr.readOnly).toBe(true);

      // Change name, then submit.
      const nameInput = screen.getByTestId(
        "patient-edit-field-name"
      ) as HTMLInputElement;
      fireEvent.change(nameInput, { target: { value: "Aarav M" } });

      const saveBtn = screen.getByTestId("patient-edit-save");
      fireEvent.click(saveBtn);

      await waitFor(() => expect(apiMock.patch).toHaveBeenCalledTimes(1));
      const [url, payload] = apiMock.patch.mock.calls[0] as [string, any];
      expect(url).toBe("/patients/p1");
      // MR must not be included in payload
      expect(payload).not.toHaveProperty("mrNumber");
      expect(payload.name).toBe("Aarav M");
      expect(payload.phone).toBe("9000000001");
    });

    it("modal cancel button closes without firing PATCH", async () => {
      authMock.mockImplementation((selector: any) => {
        const state = {
          // Issue #185: Edit is now RECEPTION/ADMIN only — was DOCTOR before
          user: { id: "u1", name: "Reception", email: "r@x.com", role: "RECEPTION" },
        };
        return typeof selector === "function" ? selector(state) : state;
      });
      mockPatientLoad();

      render(<PatientDetailPage />);
      const btn = await screen.findByTestId("patient-edit-button");
      fireEvent.click(btn);
      await screen.findByTestId("patient-edit-modal");
      fireEvent.click(screen.getByTestId("patient-edit-cancel"));
      await waitFor(() =>
        expect(screen.queryByTestId("patient-edit-modal")).toBeNull()
      );
      expect(apiMock.patch).not.toHaveBeenCalled();
    });
  });
});
