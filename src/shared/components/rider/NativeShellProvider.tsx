"use client";

/**
 * NativeShellProvider
 *
 * Top-level client component for the Rider portal that initializes
 * all native-specific behaviors when running inside Capacitor:
 *
 * 1. Android hardware back button navigation
 * 2. Native notification permission safety net
 * 3. Keyboard/viewport handling for Android WebView
 *
 * This component renders nothing visible — it's purely side-effect driven.
 */

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";
import { registerNativeBackButton } from "@/lib/capacitor/native-back-button";

export function NativeShellProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    // 1. Register Android back button handler
    registerNativeBackButton(() => router.back()).then((cleanup) => {
      cleanupRef.current = cleanup;
    });

    // 2. Handle Android soft keyboard resizing the viewport
    // Capacitor's WebView uses adjustResize by default which is correct,
    // but we ensure the viewport meta tag accounts for this.
    const viewport = document.querySelector('meta[name="viewport"]');
    if (viewport) {
      const content = viewport.getAttribute("content") || "";
      if (!content.includes("interactive-widget")) {
        viewport.setAttribute(
          "content",
          `${content}, interactive-widget=resizes-content`,
        );
      }
    }

    return () => {
      cleanupRef.current?.();
    };
  }, [router]);

  return <>{children}</>;
}
