/**
 * Tests for the mobile AI Triage chat screen.
 *
 * After the @testing-library/react-native upgrade these are real render +
 * fireEvent tests: we mount the screen, type into the composer, press send,
 * and assert the API client was called with the live session id.
 */
import { render, fireEvent, act, waitFor } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));
jest.mock("../lib/auth", () => ({
  useAuth: () => ({ user: { id: "u1", role: "PATIENT" }, isLoading: false }),
}));
jest.mock("../lib/ai", () => ({
  startTriageSession: jest.fn(),
  sendTriageMessage: jest.fn(),
  getTriageSummary: jest.fn().mockResolvedValue({
    session: {
      id: "s1",
      status: "ACTIVE",
      language: "en",
      messages: [],
      redFlagDetected: false,
      redFlagReason: null,
      confidence: null,
    },
    doctorSuggestions: [],
  }),
  bookTriageAppointment: jest.fn().mockResolvedValue({}),
}));

import AITriageChatScreen from "../app/ai/triage";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ai = require("../lib/ai");

describe("AITriageChatScreen smoke", () => {
  it("loads and exports a default component", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("../app/ai/triage");
    expect(typeof mod.default).toBe("function");
  });
});

describe("AITriageChatScreen render + send flow", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ai.startTriageSession.mockResolvedValue({
      sessionId: "s1",
      message: "Hi, how are you feeling?",
      language: "en",
      disclaimer: "Routing assistant",
    });
    ai.sendTriageMessage.mockResolvedValue({ message: "Got it." });
  });

  it("renders the initial assistant greeting after startTriageSession resolves", async () => {
    const { findByText } = render(<AITriageChatScreen />);
    expect(await findByText("Hi, how are you feeling?")).toBeTruthy();
    expect(ai.startTriageSession).toHaveBeenCalledTimes(1);
  });

  it("typing into composer and pressing send invokes sendTriageMessage(sessionId, text)", async () => {
    const { findByPlaceholderText, getByLabelText, findByText } = render(
      <AITriageChatScreen />
    );

    // Wait for the session to start so the composer becomes editable.
    await findByText("Hi, how are you feeling?");

    const input = await findByPlaceholderText("Describe your symptoms...");
    await act(async () => {
      fireEvent.changeText(input, "I have a sore throat");
    });

    const sendButton = getByLabelText("Send message");
    await act(async () => {
      fireEvent.press(sendButton);
    });

    await waitFor(() => expect(ai.sendTriageMessage).toHaveBeenCalledTimes(1));
    expect(ai.sendTriageMessage).toHaveBeenCalledWith("s1", "I have a sore throat");

    // And the assistant's reply bubble renders.
    expect(await findByText("Got it.")).toBeTruthy();
  });

  it("does not call sendTriageMessage when the composer is empty", async () => {
    const { getByLabelText, findByText } = render(<AITriageChatScreen />);
    await findByText("Hi, how are you feeling?");

    const sendButton = getByLabelText("Send message");
    await act(async () => {
      fireEvent.press(sendButton);
    });

    // Button is disabled while draft is empty — no API call should fire.
    expect(ai.sendTriageMessage).not.toHaveBeenCalled();
  });
});
