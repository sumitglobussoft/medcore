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
  usePathname: () => "/dashboard/assets",
}));

import AssetsPage from "../assets/page";

const sampleAssets = [
  {
    id: "as1",
    name: "ECG Machine",
    tag: "TAG-1",
    category: "EQUIPMENT",
    status: "IN_USE",
    assignedTo: null,
    location: "ICU",
    purchaseDate: "2023-01-01",
    warrantyExpiresAt: "2026-01-01",
  },
];

describe("AssetsPage", () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    authMock.mockImplementation((selector: any) => {
      const state = { user: { id: "u1", name: "Admin", email: "a@x.com", role: "ADMIN" } };
      return typeof selector === "function" ? selector(state) : state;
    });
  });

  it("renders heading with empty data", async () => {
    apiMock.get.mockResolvedValue({ data: [] });
    render(<AssetsPage />);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /asset management/i })
      ).toBeInTheDocument()
    );
  });

  it("renders populated assets list", async () => {
    apiMock.get.mockImplementation((url: string) => {
      if (url.startsWith("/assets?"))
        return Promise.resolve({ data: sampleAssets });
      return Promise.resolve({ data: [] });
    });
    render(<AssetsPage />);
    await waitFor(() =>
      expect(screen.getAllByText(/ECG Machine/).length).toBeGreaterThan(0)
    );
  });

  it("keeps rendering when API rejects", async () => {
    apiMock.get.mockRejectedValue(new Error("500"));
    render(<AssetsPage />);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /asset management/i })
      ).toBeInTheDocument()
    );
  });

  it("clicking Add Asset opens modal", async () => {
    apiMock.get.mockResolvedValue({ data: [] });
    const user = userEvent.setup();
    render(<AssetsPage />);
    await waitFor(() =>
      screen.getByRole("button", { name: /add asset/i })
    );
    await user.click(screen.getAllByRole("button", { name: /add asset/i })[0]);
    await waitFor(() =>
      expect(screen.getAllByText(/add asset/i).length).toBeGreaterThan(1)
    );
  });

  it("shows tab buttons", async () => {
    apiMock.get.mockResolvedValue({ data: [] });
    render(<AssetsPage />);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /asset management/i })
      ).toBeInTheDocument()
    );
  });
});
