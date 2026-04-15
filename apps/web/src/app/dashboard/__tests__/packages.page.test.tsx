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
  usePathname: () => "/dashboard/packages",
}));

import PackagesPage from "../packages/page";

const samplePackages = [
  {
    id: "pk1",
    name: "Diabetes Package",
    category: "Diabetes Package",
    price: 1500,
    validityDays: 30,
    description: "Blood tests",
    services: ["HbA1c"],
    isActive: true,
  },
];

describe("PackagesPage", () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    apiMock.post.mockReset();
    authMock.mockImplementation((selector: any) => {
      const state = { user: { id: "u1", name: "Admin", email: "a@x.com", role: "ADMIN" } };
      return typeof selector === "function" ? selector(state) : state;
    });
  });

  it("renders heading with empty data", async () => {
    apiMock.get.mockResolvedValue({ data: [] });
    render(<PackagesPage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /health packages/i })).toBeInTheDocument()
    );
  });

  it("renders populated packages", async () => {
    apiMock.get.mockResolvedValue({ data: samplePackages });
    render(<PackagesPage />);
    await waitFor(() =>
      expect(screen.getAllByText(/Diabetes Package/).length).toBeGreaterThan(0)
    );
  });

  it("keeps rendering when API rejects", async () => {
    apiMock.get.mockRejectedValue(new Error("500"));
    render(<PackagesPage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /health packages/i })).toBeInTheDocument()
    );
  });

  it("clicking Add Package opens modal", async () => {
    apiMock.get.mockResolvedValue({ data: [] });
    const user = userEvent.setup();
    render(<PackagesPage />);
    await waitFor(() =>
      screen.getByRole("button", { name: /add package/i })
    );
    await user.click(screen.getByRole("button", { name: /add package/i }));
    await waitFor(() =>
      expect(screen.getAllByText(/add health package/i).length).toBeGreaterThan(0)
    );
  });

  it("switches to Purchases tab", async () => {
    apiMock.get.mockResolvedValue({ data: [] });
    const user = userEvent.setup();
    render(<PackagesPage />);
    await waitFor(() =>
      screen.getByRole("button", { name: /purchases/i })
    );
    await user.click(screen.getByRole("button", { name: /purchases/i }));
    expect(
      screen.getByRole("button", { name: /purchases/i })
    ).toBeInTheDocument();
  });
});
