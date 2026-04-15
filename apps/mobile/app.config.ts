import type { ExpoConfig, ConfigContext } from "expo/config";

/**
 * MedCore Expo runtime config.
 *
 * The API URL can be overridden via the EXPO_PUBLIC_API_URL env var
 * (consumed at build time by EAS and at runtime by `expo start`).
 *
 * Defaults to the production deployment.
 */
const DEFAULT_API_URL = "https://medcore.globusdemos.com/api/v1";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "MedCore",
  slug: "medcore",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  scheme: "medcore",
  userInterfaceStyle: "light",
  newArchEnabled: true,
  splash: {
    image: "./assets/splash.png",
    resizeMode: "contain",
    backgroundColor: "#2563eb",
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.medcore.app",
    infoPlist: {
      UIBackgroundModes: ["remote-notification"],
    },
  },
  android: {
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#2563eb",
    },
    package: "com.medcore.app",
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON,
    permissions: ["NOTIFICATIONS", "RECEIVE_BOOT_COMPLETED", "VIBRATE"],
  },
  web: {
    bundler: "metro",
    output: "single",
    favicon: "./assets/favicon.png",
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    [
      "expo-notifications",
      {
        icon: "./assets/notification-icon.png",
        color: "#2563eb",
      },
    ],
  ],
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL || DEFAULT_API_URL,
    eas: {
      projectId: process.env.EAS_PROJECT_ID,
    },
  },
});
