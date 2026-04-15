import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { registerPushToken } from "../api";

/**
 * Registers the device for Expo push notifications and POSTs the resulting
 * Expo push token to the API. Safe to call multiple times — it short-circuits
 * after the first successful registration per app launch.
 *
 * If `expo-notifications` / `expo-device` are not installed (e.g. running in
 * Expo Go on web), the hook degrades to a no-op silently.
 */
export function usePushRegistration(enabled: boolean) {
  const didRegister = useRef(false);

  useEffect(() => {
    if (!enabled || didRegister.current) return;
    if (Platform.OS === "web") return;

    let cancelled = false;

    (async () => {
      try {
        // Lazy require so the hook works even if the native module isn't
        // bundled (e.g. unit-test or Expo-Go-without-dev-client environments).
        const Notifications = await import("expo-notifications").catch(
          () => null
        );
        const Device = await import("expo-device").catch(() => null);
        if (!Notifications) return;

        // Configure how notifications surface while the app is foregrounded.
        Notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowAlert: true,
            shouldPlaySound: true,
            shouldSetBadge: false,
            shouldShowBanner: true,
            shouldShowList: true,
          }),
        });

        if (Platform.OS === "android") {
          await Notifications.setNotificationChannelAsync("default", {
            name: "default",
            importance: Notifications.AndroidImportance.DEFAULT,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: "#2563eb",
          });
        }

        // Skip prompting on simulators — Expo push doesn't work there anyway.
        if (Device && Device.isDevice === false) return;

        const settings = await Notifications.getPermissionsAsync();
        let granted =
          settings.granted ||
          settings.ios?.status ===
            Notifications.IosAuthorizationStatus.PROVISIONAL;

        if (!granted) {
          const req = await Notifications.requestPermissionsAsync();
          granted = req.granted;
        }
        if (!granted) return;

        const tokenResp = await Notifications.getExpoPushTokenAsync();
        const token = tokenResp?.data;
        if (!token || cancelled) return;

        await registerPushToken(token, Platform.OS).catch(() => {
          // best-effort; ignore network errors
        });
        didRegister.current = true;
      } catch {
        // swallow — push is best-effort
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled]);
}
