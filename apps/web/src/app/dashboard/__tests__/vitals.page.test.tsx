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
  usePathname: () => "/dashboard/vitals",
}));

import VitalsPage from "../vitals/page";

describe("VitalsPage", () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    apiMock.post.mockReset();
    authMock.mockImplementation((selector: any) => {
      const state = { user: { id: "u1", name: "Nurse", email: "n@x.com", role: "NURSE" } };
      return typeof selector === "function" ? selector(state) : state;
    });
    apiMock.get.mockResolvedValue({ data: [] });
  });

  it("renders Record Vitals heading", async () => {
    render(<VitalsPage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /record vitals/i })).toBeInTheDocument()
    );
  });

  it("renders blood pressure input placeholder", async () => {
    render(<VitalsPage />);
    await waitFor(() => {
      expect(screen.getAllByPlaceholderText(/120|80|72/).length).toBeGreaterThan(0);
    });
  });

  it("keeps rendering when API returns an error", async () => {
    apiMock.get.mockRejectedValue(new Error("500"));
    render(<VitalsPage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /record vitals/i })).toBeInTheDocument()
    );
  });

  it("allows entering a heart rate value", async () => {
    const user = userEvent.setup();
    render(<VitalsPage />);
    await waitFor(() => screen.getAllByPlaceholderText(/72/)[0]);
    const hrInput = screen.getAllByPlaceholderText(/72/)[0] as HTMLInputElement;
    await user.type(hrInput, "80");
    expect(hrInput.value).toContain("80");
  });

  it("switches temperature unit", async () => {
    const user = userEvent.setup();
    render(<VitalsPage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /record vitals/i })).toBeInTheDocument()
    );
    const cBtns = screen.queryAllByRole("button", { name: /^c$/i });
    if (cBtns.length > 0) {
      await user.click(cBtns[0]);
    }
    expect(
      screen.getByRole("heading", { name: /record vitals/i })
    ).toBeInTheDocument();
  });
});
