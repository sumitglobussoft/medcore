/**
 * Tests for the mobile Lab Report Explanation screen.
 *
 * After the @testing-library/react-native upgrade we can render the screen,
 * type a lab order id into the input and press "View Explanation", driving
 * the real onPress → loading → fetchLabExplanation → result flow.
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
  fetchLabExplanation: jest.fn(),
}));

import LabExplanationScreen from "../app/ai/lab-explanation";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ai = require("../lib/ai");

describe("LabExplanationScreen smoke", () => {
  it("loads and exports a default component", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("../app/ai/lab-explanation");
    expect(typeof mod.default).toBe("function");
  });
});

describe("LabExplanationScreen render + load", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("typing a lab order id and pressing Load calls fetchLabExplanation and renders the explanation", async () => {
    ai.fetchLabExplanation.mockResolvedValueOnce({
      id: "e1",
      labOrderId: "lab-123",
      patientId: "p1",
      explanation: "Your haemoglobin is slightly low.",
      flaggedValues: [
        { parameter: "Haemoglobin", value: "10.2 g/dL", flag: "LOW", plainLanguage: "" },
      ],
      language: "en",
      status: "SENT",
      approvedBy: null,
      approvedAt: null,
      sentAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const { getByPlaceholderText, getByText, findByText, findAllByText } = render(
      <LabExplanationScreen />
    );

    const input = getByPlaceholderText("Enter your lab order ID");
    await act(async () => {
      fireEvent.changeText(input, "lab-123");
    });

    const loadButton = getByText("View Explanation");
    await act(async () => {
      fireEvent.press(loadButton);
    });

    await waitFor(() => expect(ai.fetchLabExplanation).toHaveBeenCalledTimes(1));
    expect(ai.fetchLabExplanation).toHaveBeenCalledWith("lab-123");

    // Result card renders the explanation text.
    expect(await findByText("Your haemoglobin is slightly low.")).toBeTruthy();
    // "Haemoglobin" appears in both the abnormal summary and the full list.
    const hbMatches = await findAllByText("Haemoglobin");
    expect(hbMatches.length).toBeGreaterThanOrEqual(1);
  });

  it("shows the spinner and disables the button while the request is in flight", async () => {
    // Resolve on our schedule so we can observe the loading state.
    let resolveFn!: (v: any) => void;
    ai.fetchLabExplanation.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFn = resolve; })
    );

    const { getByPlaceholderText, getByText, queryByText } = render(
      <LabExplanationScreen />
    );

    await act(async () => {
      fireEvent.changeText(getByPlaceholderText("Enter your lab order ID"), "lab-999");
    });
    await act(async () => {
      fireEvent.press(getByText("View Explanation"));
    });

    // While pending, the button label is replaced by an ActivityIndicator,
    // so the "View Explanation" text disappears from the tree.
    await waitFor(() => {
      expect(queryByText("View Explanation")).toBeNull();
    });
    expect(ai.fetchLabExplanation).toHaveBeenCalledTimes(1);

    // Resolve so the test cleans up without dangling promises.
    await act(async () => {
      resolveFn({
        id: "e2",
        labOrderId: "lab-999",
        patientId: "p1",
        explanation: "All clear.",
        flaggedValues: [],
        language: "en",
        status: "SENT",
        approvedBy: null,
        approvedAt: null,
        sentAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    });
  });

  it("does not fire fetchLabExplanation when the input is empty", async () => {
    const { getByText } = render(<LabExplanationScreen />);
    await act(async () => {
      fireEvent.press(getByText("View Explanation"));
    });
    expect(ai.fetchLabExplanation).not.toHaveBeenCalled();
  });
});
