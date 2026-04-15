/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("@/lib/api", () => ({ api: apiMock }));

import ForgotPasswordPage from "../forgot-password/page";

describe("ForgotPasswordPage", () => {
  beforeEach(() => {
    apiMock.post.mockReset();
  });

  it("renders the email-step form", async () => {
    render(<ForgotPasswordPage />);
    expect(screen.getByRole("heading", { name: /medcore/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/enter your email/i)).toBeInTheDocument();
  });

  it("submitting email calls forgot-password API", async () => {
    apiMock.post.mockResolvedValue({ data: {} });
    const user = userEvent.setup();
    render(<ForgotPasswordPage />);
    await user.type(
      screen.getByPlaceholderText(/enter your email/i),
      "a@x.com"
    );
    await user.click(screen.getByRole("button", { name: /send reset code/i }));
    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith("/auth/forgot-password", {
        email: "a@x.com",
      })
    );
  });

  it("shows reset step after success", async () => {
    apiMock.post.mockResolvedValue({ data: {} });
    const user = userEvent.setup();
    render(<ForgotPasswordPage />);
    await user.type(
      screen.getByPlaceholderText(/enter your email/i),
      "a@x.com"
    );
    await user.click(screen.getByRole("button", { name: /send reset code/i }));
    await waitFor(() =>
      expect(screen.getByText(/a 6-digit code has been sent/i)).toBeInTheDocument()
    );
  });

  it("shows error message on API failure", async () => {
    apiMock.post.mockRejectedValue(new Error("User not found"));
    const user = userEvent.setup();
    render(<ForgotPasswordPage />);
    await user.type(
      screen.getByPlaceholderText(/enter your email/i),
      "a@x.com"
    );
    await user.click(screen.getByRole("button", { name: /send reset code/i }));
    await waitFor(() =>
      expect(screen.getByText(/user not found/i)).toBeInTheDocument()
    );
  });

  it("renders sign-in link", async () => {
    render(<ForgotPasswordPage />);
    expect(screen.getByRole("link", { name: /sign in/i })).toBeInTheDocument();
  });
});
