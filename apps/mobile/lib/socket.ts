import { useEffect, useRef, useState } from "react";
import * as SecureStore from "expo-secure-store";
import { API_BASE_URL } from "./api";

/**
 * Strips the `/api/v1` suffix from API_BASE_URL to derive the websocket origin.
 * Falls back to the API URL itself if the suffix is absent.
 */
function deriveSocketUrl(apiUrl: string): string {
  return apiUrl.replace(/\/api\/v1\/?$/, "");
}

const ACCESS_TOKEN_KEY = "medcore_access_token";

type QueueEvent =
  | { type: "queue.update"; doctorId: string; payload: any }
  | { type: "queue.advance"; doctorId: string; tokenNumber: number }
  | { type: string; [k: string]: any };

/**
 * useQueueSocket — connects to the realtime gateway after authentication
 * and invokes `onEvent` for any queue-related event received.
 *
 * Lazy-loads `socket.io-client` so the bundle still builds if the native
 * dep is unavailable; in that case the hook is a no-op.
 */
export function useQueueSocket(
  enabled: boolean,
  onEvent: (event: QueueEvent) => void
) {
  const socketRef = useRef<any>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let cleanup: (() => void) | null = null;

    (async () => {
      try {
        const mod = await import("socket.io-client").catch(() => null);
        if (!mod || cancelled) return;
        const io = (mod as any).io || (mod as any).default;
        if (!io) return;

        const token = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
        const url = deriveSocketUrl(API_BASE_URL);

        const socket = io(url, {
          transports: ["websocket"],
          auth: token ? { token } : undefined,
          reconnection: true,
          reconnectionAttempts: 10,
          reconnectionDelay: 2000,
        });

        socketRef.current = socket;

        socket.on("connect", () => setConnected(true));
        socket.on("disconnect", () => setConnected(false));

        // The API emits multiple queue-related events; subscribe broadly
        // and forward each to the consumer.
        const events = [
          "queue.update",
          "queue.advance",
          "queue.token.called",
          "appointment.status.update",
        ];
        for (const ev of events) {
          socket.on(ev, (payload: any) =>
            onEvent({ type: ev, ...(payload || {}) })
          );
        }

        cleanup = () => {
          try {
            socket.removeAllListeners();
            socket.disconnect();
          } catch {
            // ignore
          }
        };
      } catch {
        // Bundle without socket.io-client: silently no-op
      }
    })();

    return () => {
      cancelled = true;
      if (cleanup) cleanup();
      socketRef.current = null;
      setConnected(false);
    };
    // onEvent intentionally omitted — caller should memoize if needed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { connected };
}
