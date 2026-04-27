/* eslint-disable @typescript-eslint/no-explicit-any */
// Issue #147: lab range hint used to render the unit twice — e.g.
// "Normal range: 5-10 mg/dL mg/dL" — because most `normalRange` strings
// already include the unit. This test guards the rendering logic in
// isolation (we extract the same template into the spec to avoid pulling
// the entire lab order page, which has heavy upstream API/auth deps).
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

function RangeHint({
  normalRange,
  unit,
}: {
  normalRange?: string | null;
  unit?: string | null;
}) {
  if (!normalRange) return null;
  const range = normalRange;
  const append =
    unit && !range.toLowerCase().includes(unit.toLowerCase())
      ? ` ${unit}`
      : "";
  return (
    <p data-testid="lab-range-hint">
      Normal range: {range}
      {append}
    </p>
  );
}

describe("Lab range hint — Issue #147 unit dedup", () => {
  it("does NOT duplicate the unit when normalRange already contains it", () => {
    render(<RangeHint normalRange="5-10 mg/dL" unit="mg/dL" />);
    const hint = screen.getByTestId("lab-range-hint");
    expect(hint.textContent).toBe("Normal range: 5-10 mg/dL");
  });

  it("appends the unit when normalRange does not contain it", () => {
    render(<RangeHint normalRange="5-10" unit="mg/dL" />);
    const hint = screen.getByTestId("lab-range-hint");
    expect(hint.textContent).toBe("Normal range: 5-10 mg/dL");
  });

  it("treats unit comparison as case-insensitive", () => {
    render(<RangeHint normalRange="60-100 BPM" unit="bpm" />);
    const hint = screen.getByTestId("lab-range-hint");
    expect(hint.textContent).toBe("Normal range: 60-100 BPM");
  });

  it("renders nothing when normalRange is empty", () => {
    const { container } = render(<RangeHint normalRange="" unit="mg/dL" />);
    expect(container.querySelector('[data-testid="lab-range-hint"]')).toBeNull();
  });

  it("works without a unit at all", () => {
    render(<RangeHint normalRange="<5%" unit={null} />);
    expect(screen.getByTestId("lab-range-hint").textContent).toBe(
      "Normal range: <5%"
    );
  });
});
