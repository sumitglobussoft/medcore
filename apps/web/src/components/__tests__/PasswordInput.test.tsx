/**
 * Issue #2 regression test — shared PasswordInput component.
 *
 * Guarantees:
 *  - Default render is masked (type="password"), eye icon's aria-label is
 *    "Show password".
 *  - Clicking the toggle reveals the value (type="text"); aria-label flips
 *    to "Hide password" and aria-pressed becomes true.
 *  - Clicking again re-masks — confirms the toggle is idempotent, not a
 *    one-way reveal.
 *  - The toggle is type="button" so it never submits the outer form.
 *  - `data-testid="password-toggle"` is always present for downstream E2E.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PasswordInput } from "../PasswordInput";

describe("PasswordInput (Issue #2)", () => {
  it("renders as masked by default", () => {
    render(<PasswordInput aria-label="pwd" data-testid="pwd-input" />);
    const input = screen.getByTestId("pwd-input") as HTMLInputElement;
    expect(input.type).toBe("password");
    expect(
      screen.getByRole("button", { name: /show password/i })
    ).toBeInTheDocument();
  });

  it("toggles to visible text when the eye icon is clicked, and back", async () => {
    const user = userEvent.setup();
    render(<PasswordInput aria-label="pwd" data-testid="pwd-input" />);
    const input = screen.getByTestId("pwd-input") as HTMLInputElement;
    await user.type(input, "hunter2");
    expect(input.value).toBe("hunter2");
    expect(input.type).toBe("password");

    const toggle = screen.getByTestId("password-toggle");
    await user.click(toggle);
    expect(input.type).toBe("text");
    expect(toggle).toHaveAttribute("aria-label", "Hide password");
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    await user.click(toggle);
    expect(input.type).toBe("password");
    expect(toggle).toHaveAttribute("aria-label", "Show password");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  it("toggle button is type=button (does not submit the form)", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <PasswordInput data-testid="pwd-input" aria-label="pwd" />
      </form>
    );
    await user.click(screen.getByTestId("password-toggle"));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("forwards standard input props (name, required, autoComplete, value/onChange)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <PasswordInput
        name="password"
        required
        autoComplete="current-password"
        data-testid="pwd-input"
        aria-label="pwd"
        onChange={onChange}
      />
    );
    const input = screen.getByTestId("pwd-input") as HTMLInputElement;
    expect(input).toBeRequired();
    expect(input.getAttribute("name")).toBe("password");
    expect(input.getAttribute("autoComplete") || input.getAttribute("autocomplete"))
      .toBe("current-password");
    await user.type(input, "x");
    expect(onChange).toHaveBeenCalled();
  });

  it("wires aria-describedby to a hint when provided", () => {
    render(
      <PasswordInput
        id="pwd-1"
        data-testid="pwd-input"
        hint="At least 6 characters"
      />
    );
    const input = screen.getByTestId("pwd-input");
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const hint = document.getElementById(describedBy as string);
    expect(hint?.textContent).toMatch(/at least 6 characters/i);
  });
});
