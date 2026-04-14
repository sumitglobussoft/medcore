"use client";

import { create } from "zustand";

export type ThemeMode = "light" | "dark" | "system";

interface ThemeState {
  mode: ThemeMode;
  resolved: "light" | "dark";
  setMode: (m: ThemeMode) => void;
  toggle: () => void;
  init: () => void;
}

const STORAGE_KEY = "medcore_theme";

function systemPrefersDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolve(mode: ThemeMode): "light" | "dark" {
  if (mode === "system") return systemPrefersDark() ? "dark" : "light";
  return mode;
}

function apply(resolved: "light" | "dark") {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (resolved === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
  root.style.colorScheme = resolved;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: "system",
  resolved: "light",

  setMode: (m) => {
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, m);
    }
    const resolved = resolve(m);
    apply(resolved);
    set({ mode: m, resolved });
  },

  toggle: () => {
    const { resolved } = get();
    const next: ThemeMode = resolved === "dark" ? "light" : "dark";
    get().setMode(next);
  },

  init: () => {
    if (typeof window === "undefined") return;
    const stored = (localStorage.getItem(STORAGE_KEY) as ThemeMode | null) || "system";
    const resolved = resolve(stored);
    apply(resolved);
    set({ mode: stored, resolved });

    // React to system changes when mode is "system"
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (get().mode === "system") {
        const r = systemPrefersDark() ? "dark" : "light";
        apply(r);
        set({ resolved: r });
      }
    };
    mq.addEventListener?.("change", handler);
  },
}));
