/* eslint-disable @typescript-eslint/no-explicit-any */
// Issue #137: the dashboard renders the LanguageDropdown with persistToServer
// so a logged-in user's preferredLanguage is synced to PATCH /auth/me. We
// also persist locally (verified by the existing LanguageDropdown.test.tsx
// suite) — this file specifically guards the PATCH side-effect.
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

import { LanguageDropdown } from "../LanguageDropdown";
import { useI18nStore } from "@/lib/i18n";

describe("LanguageDropdown — Issue #137 server persistence", () => {
  beforeEach(() => {
    apiMock.patch.mockReset();
    apiMock.patch.mockResolvedValue({ data: {} });
    useI18nStore.setState({ lang: "en" });
    window.localStorage.clear();
  });

  it("does NOT PATCH /auth/me when persistToServer is unset (auth pages)", async () => {
    const user = userEvent.setup();
    render(<LanguageDropdown />);
    await user.selectOptions(screen.getByLabelText("Select language"), "hi");
    // Local store + localStorage both update synchronously …
    expect(useI18nStore.getState().lang).toBe("hi");
    expect(window.localStorage.getItem("medcore_lang")).toBe("hi");
    // … but no PATCH was issued.
    expect(apiMock.patch).not.toHaveBeenCalled();
  });

  it("PATCHes /auth/me with preferredLanguage when persistToServer is set", async () => {
    const user = userEvent.setup();
    render(<LanguageDropdown persistToServer />);
    await user.selectOptions(screen.getByLabelText("Select language"), "hi");
    await waitFor(() => {
      expect(apiMock.patch).toHaveBeenCalledWith("/auth/me", {
        preferredLanguage: "hi",
      });
    });
    // Local persistence still happens — the PATCH is purely additive.
    expect(window.localStorage.getItem("medcore_lang")).toBe("hi");
  });

  it("swallows server errors so the local switch is not blocked", async () => {
    apiMock.patch.mockRejectedValueOnce(new Error("network down"));
    const user = userEvent.setup();
    render(<LanguageDropdown persistToServer />);
    await user.selectOptions(screen.getByLabelText("Select language"), "hi");
    // Even though the PATCH rejects, the UI/store have switched.
    await waitFor(() => {
      expect(useI18nStore.getState().lang).toBe("hi");
    });
  });

  it("supports a custom instanceId so multiple instances don't collide", () => {
    const { container } = render(
      <>
        <LanguageDropdown instanceId="lang-a" />
        <LanguageDropdown instanceId="lang-b" />
      </>
    );
    expect(container.querySelector("#lang-a")).not.toBeNull();
    expect(container.querySelector("#lang-b")).not.toBeNull();
  });
});
