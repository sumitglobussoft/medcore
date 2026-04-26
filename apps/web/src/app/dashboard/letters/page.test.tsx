/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: replaceMock, back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/dashboard/letters",
}));

import LegacyLettersRedirect from "./page";

describe("Legacy /dashboard/letters redirect (Issue #83)", () => {
  it("redirects to /dashboard/ai-letters and shows a hint", () => {
    render(<LegacyLettersRedirect />);
    expect(screen.getByTestId("legacy-letters-redirect")).toBeInTheDocument();
    expect(replaceMock).toHaveBeenCalledWith("/dashboard/ai-letters");
  });
});
