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
