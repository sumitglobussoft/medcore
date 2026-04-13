"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/store";

export default function Home() {
  const router = useRouter();
  const { user, isLoading, loadSession } = useAuthStore();

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.push("/login");
    } else {
      router.push("/dashboard");
    }
  }, [user, isLoading, router]);

  return (
    <div className="flex h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-primary">MedCore</h1>
        <p className="mt-2 text-gray-500">Loading...</p>
      </div>
    </div>
  );
}
