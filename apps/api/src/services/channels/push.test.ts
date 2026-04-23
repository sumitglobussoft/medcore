import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { sendPushNotificationsAsyncMock, chunkPushNotificationsMock, isExpoPushTokenMock } =
  vi.hoisted(() => ({
    sendPushNotificationsAsyncMock: vi.fn(),
    chunkPushNotificationsMock: vi.fn((messages: unknown[]) => [messages]),
    isExpoPushTokenMock: vi.fn((t: unknown) =>
      typeof t === "string" && t.startsWith("ExponentPushToken["),
    ),
  }));

vi.mock("expo-server-sdk", () => ({
  Expo: class {
    static isExpoPushToken = isExpoPushTokenMock;
    chunkPushNotifications = chunkPushNotificationsMock;
    sendPushNotificationsAsync = sendPushNotificationsAsyncMock;
  },
}));

import { sendPush } from "./push";

beforeEach(() => {
  sendPushNotificationsAsyncMock.mockReset();
  chunkPushNotificationsMock.mockClear();
  isExpoPushTokenMock.mockClear();
  isExpoPushTokenMock.mockImplementation(
    (t: unknown) => typeof t === "string" && t.startsWith("ExponentPushToken["),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("sendPush", () => {
  it("returns stub success when no valid Expo tokens are supplied", async () => {
    isExpoPushTokenMock.mockReturnValue(false);
    const res = await sendPush(["not-an-expo-token"], "t", "b");
    expect(res.ok).toBe(true);
    expect(res.messageId).toBe("no-tokens");
    expect(sendPushNotificationsAsyncMock).not.toHaveBeenCalled();
  });

  it("dispatches valid Expo tokens via the SDK and collects ticket ids", async () => {
    sendPushNotificationsAsyncMock.mockResolvedValueOnce([
      { status: "ok", id: "receipt-1" },
      { status: "ok", id: "receipt-2" },
    ]);
    const res = await sendPush(
      ["ExponentPushToken[aaa]", "ExponentPushToken[bbb]"],
      "Title",
      "Body",
    );
    expect(sendPushNotificationsAsyncMock).toHaveBeenCalledTimes(1);
    const chunk = sendPushNotificationsAsyncMock.mock.calls[0][0] as any[];
    expect(chunk).toHaveLength(2);
    expect(chunk[0]).toMatchObject({
      to: "ExponentPushToken[aaa]",
      title: "Title",
      body: "Body",
    });
    expect(res.ok).toBe(true);
    expect(res.messageId).toBe("receipt-1,receipt-2");
  });

  it("returns {ok:false} when the SDK throws", async () => {
    sendPushNotificationsAsyncMock.mockRejectedValueOnce(new Error("network down"));
    const res = await sendPush(["ExponentPushToken[xxx]"], "t", "b");
    expect(res.ok).toBe(false);
    expect(res.error).toContain("network down");
  });
});
