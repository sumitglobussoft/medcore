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
  usePathname: () => "/dashboard/admissions/test-id",
  useParams: () => ({ id: "test-id" }),
}));

import AdmissionDetailPage from "../admissions/[id]/page";

const sampleAdmission = {
  id: "adm1",
  admissionNumber: "ADM-100",
  admittedAt: new Date().toISOString(),
  status: "ADMITTED",
  reason: "Observation",
  diagnosis: "Fever",
  patient: {
    id: "p1",
    mrNumber: "MR-1",
    user: { name: "Aarav Mehta", phone: "9000000001" },
  },
  doctor: { id: "d1", user: { name: "Dr. Singh" } },
  bed: { id: "b1", bedNumber: "B-1", ward: { id: "w1", name: "General" } },
};

function renderPage() {
  return render(
    <AdmissionDetailPage params={Promise.resolve({ id: "test-id" }) as any} />
  );
}

describe("AdmissionDetailPage", () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    apiMock.patch.mockReset();
    authMock.mockImplementation((selector: any) => {
      const state = { user: { id: "u1", name: "Admin", email: "a@x.com", role: "ADMIN" } };
      return typeof selector === "function" ? selector(state) : state;
    });
  });

  it("renders loading initially", async () => {
    apiMock.get.mockReturnValue(new Promise(() => {}));
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/loading/i)).toBeInTheDocument()
    );
  });

  it("shows not-found when admission fetch fails", async () => {
    apiMock.get.mockRejectedValue(new Error("404"));
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/admission not found/i)).toBeInTheDocument()
    );
  });

  it("renders populated admission details", async () => {
    apiMock.get.mockImplementation((url: string) => {
      if (url.startsWith("/admissions/test-id"))
        return Promise.resolve({ data: sampleAdmission });
      return Promise.resolve({ data: [] });
    });
    renderPage();
    await waitFor(() =>
      expect(screen.getAllByText("Aarav Mehta").length).toBeGreaterThan(0)
    );
    expect(screen.getAllByText(/ADM-100/).length).toBeGreaterThan(0);
  });

  it("switches tabs without crashing", async () => {
    apiMock.get.mockImplementation((url: string) => {
      if (url.startsWith("/admissions/test-id"))
        return Promise.resolve({ data: sampleAdmission });
      return Promise.resolve({ data: [] });
    });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() =>
      screen.getAllByRole("button", { name: /vitals/i })[0]
    );
    await user.click(screen.getAllByRole("button", { name: /vitals/i })[0]);
    expect(
      screen.getAllByRole("button", { name: /vitals/i }).length
    ).toBeGreaterThan(0);
  });

  it("renders without crashing when API returns empty", async () => {
    apiMock.get.mockResolvedValue({ data: null });
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/admission not found/i)).toBeInTheDocument()
    );
  });
});
