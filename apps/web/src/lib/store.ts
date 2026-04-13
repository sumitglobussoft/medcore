import { create } from "zustand";
import { api } from "./api";

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  loadSession: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isLoading: true,

  login: async (email: string, password: string) => {
    const res = await api.post<{
      success: boolean;
      data: {
        user: User;
        tokens: { accessToken: string; refreshToken: string };
      };
    }>("/auth/login", { email, password });

    const { user, tokens } = res.data;
    localStorage.setItem("medcore_token", tokens.accessToken);
    localStorage.setItem("medcore_refresh", tokens.refreshToken);
    set({ user, token: tokens.accessToken, isLoading: false });
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
