/* eslint-disable @typescript-eslint/no-explicit-any */
// Issue #102: the email field's native validation tooltip used to overlap
// the Password label on Chromium. The fix is two-fold:
//   1. The form must declare `noValidate` so the browser does not show its
//      native popover.
//   2. Per-field error messages render as in-DOM <p data-testid="error-{field}">
//      so browser automation (and screen readers) can pick them up.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { loginMock, verify2FAMock, pushMock } = vi.hoisted(() => ({
  loginMock: vi.fn(),
  verify2FAMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock("@/lib/store", () => ({
  useAuthStore: () => ({
    login: loginMock,
    verify2FA: verify2FAMock,
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
  usePathname: () => "/login",
  useSearchParams: () => ({ get: (_k: string) => null }),
}));

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/components/LanguageDropdown", () => ({
  LanguageDropdown: () => null,
}));

import LoginPage from "../login/page";

describe("LoginPage — Issue #102 noValidate + inline email error", () => {
  beforeEach(() => {
    loginMock.mockReset();
    verify2FAMock.mockReset();
    pushMock.mockReset();
  });

  it("renders the login form with noValidate so the browser tooltip is suppressed", () => {
    render(<LoginPage />);
    const form = screen.getByRole("form", { name: /login form/i });
    // The DOM property is `noValidate`; the attribute is `novalidate`.
    expect((form as HTMLFormElement).noValidate).toBe(true);
  });

  it("shows an inline data-testid=error-email span when the email is empty on submit", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    // Click submit without typing — client-side validator should catch it
    // and render the inline <p data-testid="error-email">.
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));
    await waitFor(() => {
      expect(screen.getByTestId("error-email")).toBeInTheDocument();
    });
    // The login mock must not have been called — the inline error short-circuits.
    expect(loginMock).not.toHaveBeenCalled();
  });

  it("shows an inline data-testid=error-email when the email is malformed", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText(/email/i), "not-an-email");
    await user.type(screen.getByLabelText(/^password$/i), "correct-horse");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));
    await waitFor(() => {
      expect(screen.getByTestId("error-email")).toHaveTextContent(/valid/i);
    });
    expect(loginMock).not.toHaveBeenCalled();
  });
});
