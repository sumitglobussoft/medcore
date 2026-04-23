// Skip RNTL's strict `react` <-> `react-test-renderer` version-match check.
// In this monorepo, `react` hoists to 19.x at the root (pulled up by other
// workspaces) while the app's own package.json still declares 18.3.1. The
// library itself works fine against react-test-renderer 19.x in practice;
// we just need to mute the startup assertion, which is a friendly warning.
process.env.RNTL_SKIP_DEPS_CHECK = "1";

// Stub modules that need native bindings during Jest unit tests.
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiUrl: "https://example.test/api/v1" } } },
}));

jest.mock("@expo/vector-icons", () => ({
  Ionicons: () => null,
}));
