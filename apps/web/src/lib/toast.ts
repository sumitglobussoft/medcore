"use client";

import { create } from "zustand";

export type ToastKind = "success" | "error" | "info" | "warning";

export interface ToastItem {
  id: string;
  kind: ToastKind;
  message: string;
  duration: number;
}

interface ToastState {
  toasts: ToastItem[];
  push: (kind: ToastKind, message: string, duration?: number) => void;
  dismiss: (id: string) => void;
  clear: () => void;
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (kind, message, duration = 4000) => {
    const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const item: ToastItem = { id, kind, message, duration };
    set({ toasts: [...get().toasts, item] });
    if (duration > 0 && typeof window !== "undefined") {
      window.setTimeout(() => get().dismiss(id), duration);
    }
  },
  dismiss: (id) => {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
  clear: () => set({ toasts: [] }),
}));

export const toast = {
  success: (message: string, duration?: number) =>
    useToastStore.getState().push("success", message, duration),
  error: (message: string, duration?: number) =>
    useToastStore.getState().push("error", message, duration),
  info: (message: string, duration?: number) =>
    useToastStore.getState().push("info", message, duration),
  warning: (message: string, duration?: number) =>
    useToastStore.getState().push("warning", message, duration),
};
