/**
 * Tests for the mobile medication-adherence screen.
 *
 * After the @testing-library/react-native upgrade we can finally render the
 * screen for real and drive chip taps through fireEvent.press, exercising the
 * full onPress → optimistic-toggle → markDoseTaken flow instead of the old
 * client-wiring simulation.
 */
import { render, fireEvent, act, waitFor } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({}),
  // In tests we only care that the mounted callback does not crash; do not
  // re-invoke on every render or FlatList diffs start to flicker.
  useFocusEffect: jest.fn(),
}));
jest.mock("../lib/auth", () => ({
  useAuth: () => ({ user: { id: "u1", patientId: "p1", role: "PATIENT" }, isLoading: false }),
}));
jest.mock("../lib/ai", () => ({
  fetchAdherenceSchedules: jest.fn(),
  enrollAdherence: jest.fn().mockResolvedValue({}),
  unenrollAdherence: jest.fn().mockResolvedValue(undefined),
  fetchDoseLog: jest.fn().mockResolvedValue([]),
  markDoseTaken: jest.fn(),
}));

// Silence the Alert.alert call the screen emits on markDose failure — we
// assert the revert instead of the dialog.
jest.spyOn(require("react-native").Alert, "alert").mockImplementation(() => {});

import AdherenceScreen from "../app/ai/adherence";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ai = require("../lib/ai");

const baseSchedule = {
  id: "sched-1",
  patientId: "p1",
  prescriptionId: "rx-1",
  medications: [
    {
      name: "Paracetamol",
      dosage: "500mg",
      frequency: "1-0-1",
      duration: "5 days",
      reminderTimes: ["08:00", "20:00"],
    },
  ],
  startDate: new Date().toISOString(),
  endDate: new Date(Date.now() + 5 * 86400000).toISOString(),
  active: true,
  remindersSent: 0,
  lastReminderAt: null,
  createdAt: new Date().toISOString(),
};

describe("AdherenceScreen smoke", () => {
  it("loads and exports a default component", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("../app/ai/adherence");
    expect(typeof mod.default).toBe("function");
  });
});

describe("AdherenceScreen render + press", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ai.fetchAdherenceSchedules.mockResolvedValue([baseSchedule]);
    ai.fetchDoseLog.mockResolvedValue([]);
  });

  it("renders medication chips from fetchAdherenceSchedules", async () => {
    const { findByText } = render(<AdherenceScreen />);
    expect(await findByText("Paracetamol")).toBeTruthy();
    expect(await findByText("08:00")).toBeTruthy();
    expect(await findByText("20:00")).toBeTruthy();
  });

  it("tapping a chip invokes markDoseTaken with {scheduleId, medicationName, ISO scheduledAt, ISO takenAt}", async () => {
    ai.markDoseTaken.mockResolvedValueOnce({
      id: "d1",
      scheduledAt: "",
      takenAt: "",
      status: "TAKEN",
    });

    const { findByLabelText } = render(<AdherenceScreen />);
    const chip = await findByLabelText("Dose at 08:00");

    await act(async () => {
      fireEvent.press(chip);
    });

    await waitFor(() => expect(ai.markDoseTaken).toHaveBeenCalledTimes(1));
    const [scheduleIdArg, bodyArg] = ai.markDoseTaken.mock.calls[0];
    expect(scheduleIdArg).toBe("sched-1");
    expect(bodyArg.medicationName).toBe("Paracetamol");
    expect(typeof bodyArg.scheduledAt).toBe("string");
    expect(typeof bodyArg.takenAt).toBe("string");
    const parsed = new Date(bodyArg.scheduledAt);
    expect(parsed.getHours()).toBe(8);
    expect(parsed.getMinutes()).toBe(0);
  });

  it("reverts chip state when markDoseTaken rejects", async () => {
    ai.markDoseTaken.mockRejectedValueOnce(new Error("network down"));

    const { findByLabelText } = render(<AdherenceScreen />);
    const chip = await findByLabelText("Dose at 08:00");

    await act(async () => {
      fireEvent.press(chip);
    });

    // After the reject settles the screen re-renders with the chip reverted
    // to the un-taken label (no trailing ", taken").
    await waitFor(() => expect(ai.markDoseTaken).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      // Still just "Dose at 08:00"; a successful mark would have changed the
      // label to include ", taken".
      expect(chip.props.accessibilityLabel).toBe("Dose at 08:00");
    });
  });
});
