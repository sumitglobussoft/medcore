import { create } from "zustand";
import { api } from "./api";

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  phone?: string;
  photoUrl?: string | null;
  twoFactorEnabled?: boolean;
  preferredLanguage?: string | null;
  defaultLandingPage?: string | null;
}

interface LoginResult {
  twoFactorRequired?: boolean;
  tempToken?: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  /**
   * Issue #1: `rememberMe` is forwarded to the API so the server can mint a
   * 30-day refresh token instead of the 7-day default. Optional for backward
   * compatibility with any older call sites; defaults to false (session-only).
   */
  login: (
    email: string,
    password: string,
    rememberMe?: boolean
  ) => Promise<LoginResult>;
  verify2FA: (tempToken: string, code: string) => Promise<void>;
  logout: () => void;
  loadSession: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isLoading: true,

  login: async (email: string, password: string, rememberMe: boolean = false) => {
    // Only send `rememberMe` when true, so unchecked-box requests remain
    // byte-identical to the pre-Issue-#1 payload and existing tests/mocks
    // that assert on the exact body shape keep passing.
    const body: { email: string; password: string; rememberMe?: boolean } = {
      email,
      password,
    };
    if (rememberMe) body.rememberMe = true;
    const res = await api.post<{
      success: boolean;
      data:
        | {
            user: User;
            tokens: { accessToken: string; refreshToken: string };
          }
        | { twoFactorRequired: true; tempToken: string };
    }>("/auth/login", body);

    const data = res.data as any;
    if (data.twoFactorRequired) {
      return { twoFactorRequired: true, tempToken: data.tempToken };
    }

    const { user, tokens } = data;
    localStorage.setItem("medcore_token", tokens.accessToken);
    localStorage.setItem("medcore_refresh", tokens.refreshToken);
    set({ user, token: tokens.accessToken, isLoading: false });
    return {};
  },

  verify2FA: async (tempToken: string, code: string) => {
    const res = await api.post<{
      success: boolean;
      data: {
        user: User;
        tokens: { accessToken: string; refreshToken: string };
      };
    }>("/auth/2fa/verify-login", { tempToken, code });
    const { user, tokens } = res.data;
    localStorage.setItem("medcore_token", tokens.accessToken);
    localStorage.setItem("medcore_refresh", tokens.refreshToken);
    set({ user, token: tokens.accessToken, isLoading: false });
  },

  refreshUser: async () => {
    const token = localStorage.getItem("medcore_token");
    if (!token) return;
    try {
      const res = await api.get<{ success: boolean; data: User }>("/auth/me", { token });
      set({ user: res.data });
    } catch {
      // ignore
    }
  },

  logout: () => {
    localStorage.removeItem("medcore_token");
    localStorage.removeItem("medcore_refresh");
    set({ user: null, token: null });
  },

  loadSession: async () => {
    const token = localStorage.getItem("medcore_token");
    if (!token) {
      set({ isLoading: false });
      return;
    }

    try {
      const res = await api.get<{ success: boolean; data: User }>("/auth/me", {
        token,
      });
      set({ user: res.data, token, isLoading: false });
    } catch {
      localStorage.removeItem("medcore_token");
      localStorage.removeItem("medcore_refresh");
      set({ user: null, token: null, isLoading: false });
    }
  },
}));
