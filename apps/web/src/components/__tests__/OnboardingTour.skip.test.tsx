/* eslint-disable @typescript-eslint/no-explicit-any */
// Issue #122: hitting "Skip tour" on one page must persist a per-user flag
// so the tour does not reappear on sibling pages. The flag is keyed by user
// id (`medcore_onboarding_skipped:<userId>`) so multi-user kiosks behave
// correctly.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import {
  OnboardingTour,
  hasCompletedTour,
  hasSkippedOnboarding,
  onboardingSkipKey,
  resetTour,
  clearOnboardingSkipped,
} from "../OnboardingTour";

describe("OnboardingTour — Issue #122 skip persistence", () => {
  const USER_ID = "u_test_42";
  const ROLE = "DOCTOR";

  beforeEach(() => {
    window.localStorage.clear();
  });

  it("persists the skip flag to localStorage under the user-id-keyed key", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <OnboardingTour
        role={ROLE}
        userId={USER_ID}
        open={true}
        onClose={onClose}
      />
    );
    await user.click(screen.getByRole("button", { name: /skip tour/i }));
    expect(
      window.localStorage.getItem(onboardingSkipKey(USER_ID))
    ).toBe("1");
    expect(onClose).toHaveBeenCalled();
  });

  it("hasSkippedOnboarding reads back the persisted flag", () => {
    expect(hasSkippedOnboarding(USER_ID)).toBe(false);
    window.localStorage.setItem(onboardingSkipKey(USER_ID), "1");
    expect(hasSkippedOnboarding(USER_ID)).toBe(true);
  });

  it("hasCompletedTour returns true when the per-user skip flag is set, regardless of role", () => {
    // Different role-specific completion key is empty …
    expect(hasCompletedTour("ADMIN", USER_ID)).toBe(false);
    // … but once the per-user skip flag is set, ANY role check is suppressed.
    window.localStorage.setItem(onboardingSkipKey(USER_ID), "1");
    expect(hasCompletedTour("ADMIN", USER_ID)).toBe(true);
    expect(hasCompletedTour("RECEPTION", USER_ID)).toBe(true);
  });

  it("resetTour clears both the role completion AND the per-user skip flag", () => {
    window.localStorage.setItem("mc_tour_DOCTOR", "1");
    window.localStorage.setItem(onboardingSkipKey(USER_ID), "1");
    act(() => resetTour(ROLE, USER_ID));
    expect(window.localStorage.getItem("mc_tour_DOCTOR")).toBeNull();
    expect(window.localStorage.getItem(onboardingSkipKey(USER_ID))).toBeNull();
  });

  it("clearOnboardingSkipped is a no-op when no userId is supplied", () => {
    window.localStorage.setItem(onboardingSkipKey(USER_ID), "1");
    clearOnboardingSkipped(null);
    expect(
      window.localStorage.getItem(onboardingSkipKey(USER_ID))
    ).toBe("1");
  });
});
