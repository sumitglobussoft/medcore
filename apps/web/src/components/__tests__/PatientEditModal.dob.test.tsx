/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Issue #85 — DOB roundtrip for the patient edit modal.
 *
 * The bug: opening the edit modal for a patient whose `dateOfBirth` came
 * from a JSON-deserialised API response (full ISO timestamp like
 * `"2024-05-12T00:00:00.000Z"`) used to leave the date input blank — the
 * `<input type="date">` element silently rejects values that aren't already
 * `YYYY-MM-DD`. Saving the form then sent no `dateOfBirth` at all, and the
 * patient's DOB was effectively lost on each round-trip.
 *
 * These tests pin the new `isoDateInput()` behaviour (string + Date inputs)
 * and the on-save payload shape (a clean `YYYY-MM-DD` string).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { apiMock, toastMock } = vi.hoisted(() => ({
  apiMock: { patch: vi.fn(), get: vi.fn(), post: vi.fn() },
  toastMock: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/lib/toast", () => ({ toast: toastMock }));
vi.mock("@/lib/i18n", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import { PatientEditModal, type EditablePatient } from "../PatientEditModal";

const basePatient: EditablePatient = {
  id: "pt-1",
  mrNumber: "MR-0001",
  gender: "MALE",
  bloodGroup: null,
  address: null,
  user: { name: "Alex Doe", email: "alex@example.com", phone: "9876543210" },
};

describe("PatientEditModal — DOB roundtrip (Issue #85)", () => {
  beforeEach(() => {
    apiMock.patch.mockReset();
    toastMock.success.mockReset();
    toastMock.error.mockReset();
  });

  it("pre-fills the date input from a full ISO timestamp string", () => {
    render(
      <PatientEditModal
        open
        patient={{ ...basePatient, dateOfBirth: "1990-04-12T00:00:00.000Z" }}
        onClose={() => {}}
        onSaved={() => {}}
      />
    );
    const dob = screen.getByTestId(
      "patient-edit-field-dateOfBirth"
    ) as HTMLInputElement;
    expect(dob.value).toBe("1990-04-12");
  });

  it("pre-fills the date input when DOB arrives as a Date instance", () => {
    render(
      <PatientEditModal
        open
        patient={{
          ...basePatient,
          // Mid-day UTC — the bug used to surface here because IST conversion
          // shifted the displayed date by a day. We extract UTC parts now.
          dateOfBirth: new Date("1985-08-23T12:34:56.000Z"),
        }}
        onClose={() => {}}
        onSaved={() => {}}
      />
    );
    const dob = screen.getByTestId(
      "patient-edit-field-dateOfBirth"
    ) as HTMLInputElement;
    expect(dob.value).toBe("1985-08-23");
  });

  it("submits the DOB as a clean YYYY-MM-DD payload (no time portion)", async () => {
    apiMock.patch.mockResolvedValueOnce({ data: { id: "pt-1" } });
    const onSaved = vi.fn();
    render(
      <PatientEditModal
        open
        patient={{ ...basePatient, dateOfBirth: "1990-04-12T00:00:00.000Z" }}
        onClose={() => {}}
        onSaved={onSaved}
      />
    );

    await userEvent.click(screen.getByTestId("patient-edit-save"));

    await waitFor(() => expect(apiMock.patch).toHaveBeenCalledTimes(1));
    const [, payload] = apiMock.patch.mock.calls[0];
    // The payload's dateOfBirth must be the date-only string — never a full
    // ISO timestamp and never `undefined`.
    expect(payload.dateOfBirth).toBe("1990-04-12");
    expect(onSaved).toHaveBeenCalled();
  });

  it("leaves dateOfBirth out of the payload when the patient had no DOB", async () => {
    apiMock.patch.mockResolvedValueOnce({ data: { id: "pt-1" } });
    render(
      <PatientEditModal
        open
        patient={{ ...basePatient, dateOfBirth: null }}
        onClose={() => {}}
        onSaved={() => {}}
      />
    );
    await userEvent.click(screen.getByTestId("patient-edit-save"));
    await waitFor(() => expect(apiMock.patch).toHaveBeenCalled());
    const [, payload] = apiMock.patch.mock.calls[0];
    expect(payload).not.toHaveProperty("dateOfBirth");
  });
});
