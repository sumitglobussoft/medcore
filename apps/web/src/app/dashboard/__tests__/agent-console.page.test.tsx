/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const { apiMock, authMock, toastMock, socketMock, routerReplace } = vi.hoisted(
  () => ({
    apiMock: {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
    authMock: vi.fn(),
    toastMock: {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warning: vi.fn(),
    },
    socketMock: {
      connect: vi.fn(),
      disconnect: vi.fn(),
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      connected: false,
    },
    routerReplace: vi.fn(),
  }),
);

vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/lib/store", () => ({ useAuthStore: authMock }));
vi.mock("@/lib/toast", () => ({ toast: toastMock }));
vi.mock("@/lib/socket", () => ({ getSocket: () => socketMock }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: routerReplace,
    back: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/dashboard/agent-console",
}));

import AgentConsolePage from "../agent-console/page";

function mockHandoff(overrides: Partial<any> = {}): any {
  return {
    chatRoomId: "r1",
    sessionId: "s1",
    roomName: "AI Triage Handoff",
    patient: { id: "p1", name: "Priya Sharma", mrNumber: "MRN-1" },
    presentingComplaint: "Persistent headache",
    language: "en",
    confidence: 0.8,
    handoffAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    unreadCount: 1,
    lastMessage: null,
    ...overrides,
  };
}

function mockContext(overrides: Partial<any> = {}): any {
  return {
    sessionId: "s1",
    chatRoomId: "r1",
    language: "en",
    status: "COMPLETED",
    redFlagDetected: false,
    redFlagReason: null,
    patient: {
      id: "p1",
      mrNumber: "MRN-1",
      name: "Priya Sharma",
      phone: null,
      dateOfBirth: null,
      gender: "FEMALE",
    },
    transcript: [
      { role: "assistant", content: "Hello! How can I help?" },
      { role: "user", content: "I have a headache for 3 days" },
      { role: "assistant", content: "Any nausea?" },
      { role: "user", content: "Yes, some nausea and light sensitivity" },
    ],
    soap: {
      subjective: {
        chiefComplaint: "Persistent headache",
        onset: "3 days ago",
        duration: "72 hours",
        severity: 5,
        associatedSymptoms: ["nausea", "light sensitivity"],
        relevantHistory: null,
      },
      assessment: {
        suggestedSpecialties: [{ specialty: "Neurology", confidence: 0.8 }],
        confidence: 0.8,
      },
    },
    topDoctors: [
      {
        doctorId: "d1",
        name: "Dr. Suresh Kumar",
        specialty: "Neurology",
        subSpecialty: null,
        qualification: "MBBS, MD",
        experienceYears: 10,
        consultationFee: 800,
        reasoning: "Specialist in headache disorders",
      },
    ],
    ...overrides,
  };
}

describe("AgentConsolePage", () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    apiMock.post.mockReset();
    apiMock.patch.mockReset();
    routerReplace.mockReset();
    authMock.mockImplementation((selector: any) => {
      const state = {
        user: {
          id: "u1",
          name: "Reception",
          email: "r@x.com",
          role: "RECEPTION",
        },
        isLoading: false,
      };
      return typeof selector === "function" ? selector(state) : state;
    });
    apiMock.get.mockImplementation((url: string) => {
      if (url.startsWith("/agent-console/handoffs/") && url.endsWith("/context")) {
        return Promise.resolve({ data: mockContext() });
      }
      if (url === "/agent-console/handoffs") {
        return Promise.resolve({ data: [mockHandoff()] });
      }
      if (url.includes("/chat/rooms/") && url.includes("/messages")) {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: [] });
    });
    apiMock.post.mockResolvedValue({ data: {} });
    apiMock.patch.mockResolvedValue({ data: {} });
  });

  it("renders the handoff list from /agent-console/handoffs", async () => {
    render(<AgentConsolePage />);
    await waitFor(() => {
      expect(screen.getByText(/Priya Sharma/)).toBeInTheDocument();
    });
    // Presenting complaint + language badge are visible in the left pane
    expect(screen.getByText(/Persistent headache/)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Agent Console/i }),
    ).toBeInTheDocument();
  });

  it("loads the triage transcript into the AI co-pilot pane when a handoff is selected", async () => {
    render(<AgentConsolePage />);
    // Click the left-pane handoff row to select it
    const row = await screen.findByText(/Priya Sharma/);
    fireEvent.click(row);
    // Co-pilot transcript shows both patient + AI turns
    const transcript = await screen.findByTestId("agent-console-transcript");
    expect(transcript.textContent).toMatch(/headache for 3 days/i);
    expect(transcript.textContent).toMatch(/nausea and light sensitivity/i);
    // SOAP extract surfaces chief complaint
    expect(screen.getByText(/Chief complaint/i)).toBeInTheDocument();
    // Top doctor card renders
    await waitFor(() => {
      expect(screen.getByText(/Dr\. Suresh Kumar/)).toBeInTheDocument();
    });
  });

  it("'Suggest this doctor' button pre-fills the composer and posts to /suggest-doctor", async () => {
    render(<AgentConsolePage />);
    const row = await screen.findByText(/Priya Sharma/);
    fireEvent.click(row);
    const btn = await screen.findByTestId("suggest-doctor-d1");
    fireEvent.click(btn);

    await waitFor(() => {
      const composer = screen.getByTestId(
        "agent-console-composer",
      ) as HTMLTextAreaElement;
      expect(composer.value).toMatch(/Suggested doctor/);
      expect(composer.value).toMatch(/Dr\. Dr\. Suresh Kumar|Dr\. Suresh Kumar/);
      expect(composer.value).toMatch(/Neurology/);
    });

    await waitFor(() => {
      const posts = apiMock.post.mock.calls.map((c) => String(c[0]));
      expect(
        posts.some((u) => u.includes("/agent-console/handoffs/r1/suggest-doctor")),
      ).toBe(true);
    });
  });

  it("redirects non-agent roles (DOCTOR) to /dashboard", async () => {
    authMock.mockImplementation((selector: any) => {
      const state = {
        user: { id: "u2", name: "Doc", email: "d@x.com", role: "DOCTOR" },
        isLoading: false,
      };
      return typeof selector === "function" ? selector(state) : state;
    });
    render(<AgentConsolePage />);
    await waitFor(() => {
      expect(routerReplace).toHaveBeenCalledWith("/dashboard");
    });
  });
});
