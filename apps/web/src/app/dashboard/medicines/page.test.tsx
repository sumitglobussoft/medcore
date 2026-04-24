/* eslint-disable @typescript-eslint/no-explicit-any */
// Component tests for the Medicines dashboard page — Issue #40 + #41.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

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
vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/dashboard/medicines",
}));

import MedicinesPage from "./page";

const sampleMedicines = [
  {
    id: "m1",
    name: "Amlodipine 5mg",
    genericName: "Amlodipine",
    form: "Tablet",
    strength: "5mg",
    category: "Cardiovascular",
    rxRequired: true,
    manufacturer: "Cipla",
  },
  {
    id: "m2",
    name: "Paracetamol 500mg",
    genericName: "Paracetamol",
    form: "Tablet",
    strength: "500mg",
    category: "Analgesic",
    rxRequired: false,
    manufacturer: "GSK",
  },
];

describe("MedicinesPage (Issue #40 + #41 regression)", () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    apiMock.post.mockReset();
    authMock.mockImplementation((selector: any) => {
      const state = {
        user: { id: "u1", name: "Admin", email: "a@x.com", role: "ADMIN" },
      };
      return typeof selector === "function" ? selector(state) : state;
    });
  });

  it("renders the manufacturer for every medicine in the list", async () => {
    apiMock.get.mockResolvedValue({ data: sampleMedicines });
    render(<MedicinesPage />);
    await waitFor(() => {
      // Both rows must render a Mfg label with a non-empty value.
      const mfgCells = screen.getAllByTestId("medicine-manufacturer");
      expect(mfgCells).toHaveLength(2);
      expect(mfgCells[0].textContent).toMatch(/Cipla/);
      expect(mfgCells[1].textContent).toMatch(/GSK/);
    });
  });

  it("does NOT render 'Mfg: —' for any row when manufacturer is present", async () => {
    apiMock.get.mockResolvedValue({ data: sampleMedicines });
    render(<MedicinesPage />);
    await waitFor(() => {
      const mfgCells = screen.getAllByTestId("medicine-manufacturer");
      for (const cell of mfgCells) {
        expect(cell.textContent).not.toMatch(/Mfg: —/);
      }
    });
  });

  it("renders an Rx badge on prescription-only medicines (Amlodipine)", async () => {
    apiMock.get.mockResolvedValue({ data: sampleMedicines });
    render(<MedicinesPage />);
    // The Rx badge only appears when rxRequired=true. Amlodipine has it,
    // Paracetamol does not — so exactly one Rx badge should be visible.
    await waitFor(() => {
      const badges = screen.getAllByText("Rx");
      expect(badges).toHaveLength(1);
    });
  });

  it("falls back to '—' when manufacturer is missing (safety display)", async () => {
    apiMock.get.mockResolvedValue({
      data: [
        {
          id: "m3",
          name: "Legacy Drug",
          rxRequired: false,
          manufacturer: null,
        },
      ],
    });
    render(<MedicinesPage />);
    await waitFor(() => {
      expect(
        screen.getByTestId("medicine-manufacturer").textContent
      ).toMatch(/Mfg: —/);
    });
  });
});
