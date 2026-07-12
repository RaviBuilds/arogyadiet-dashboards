"use client";

/**
 * BatteryPermissionOnboarding
 *
 * Rider-facing onboarding that ensures live location tracking survives Doze
 * and OEM background-app killers (Vivo, Xiaomi, Oppo, Realme, OnePlus,
 * Samsung). Without this, tracking silently stops a few minutes after the
 * rider locks their screen or switches apps — the exact complaint that
 * motivated the native tracking rework.
 *
 * Behavior:
 * - On native platforms only (no-op on web).
 * - Checks stock Android battery-optimization status via the native plugin.
 * - If NOT exempt, shows a persistent (non-dismissible-forever) banner. The
 *   rider can dismiss it for the current session, but it resurfaces next
 *   app open until the permission is actually granted.
 * - Tapping the banner opens a dialog with:
 *     1. A button that triggers the stock Android exemption system prompt.
 *     2. Manufacturer-specific manual steps (resolved from Build.MANUFACTURER)
 *        for the OEM-level power manager, which stock Android cannot reach.
 * - Re-checks status when the app returns to the foreground, so the banner
 *   clears automatically once the rider completes the steps.
 */

import { useCallback, useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import { BackgroundGeolocation } from "@/lib/capacitor/background-geolocation-stub";
import {
  getOemInstructions,
  type OemInstructions,
} from "@/lib/capacitor/oem-battery-instructions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Button } from "@/shared/components/ui/button";
import { BatteryWarning, ShieldCheck } from "lucide-react";

const SESSION_DISMISS_KEY = "rider_battery_banner_dismissed";

export function BatteryPermissionOnboarding() {
  const [status, setStatus] = useState<"checking" | "ok" | "needs-setup">(
    "checking",
  );
  const [oem, setOem] = useState<OemInstructions | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [requesting, setRequesting] = useState(false);

  const checkStatus = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) {
      setStatus("ok");
      return;
    }
    try {
      const result = await BackgroundGeolocation.getBatteryOptimizationStatus();
      setOem(getOemInstructions(result.manufacturer));
      setStatus(result.isIgnoringBatteryOptimizations ? "ok" : "needs-setup");
    } catch (err) {
      // If the native call fails (older APK without this method deployed
      // yet), fail open — don't block the rider with an unusable dialog.
      console.error("getBatteryOptimizationStatus failed:", err);
      setStatus("ok");
    }
  }, []);

  useEffect(() => {
    checkStatus();

    if (typeof window !== "undefined") {
      setBannerDismissed(
        sessionStorage.getItem(SESSION_DISMISS_KEY) === "true",
      );
    }

    // Re-check whenever the rider comes back to the app — e.g. after
    // visiting Settings/i Manager to complete the steps, or after backing
    // out of the system battery-exemption prompt.
    if (!Capacitor.isNativePlatform()) return;
    const listener = CapacitorApp.addListener("appStateChange", (state) => {
      if (state.isActive) {
        checkStatus();
      }
    });
    return () => {
      listener.then((h) => h.remove());
    };
  }, [checkStatus]);

  const handleRequestExemption = async () => {
    setRequesting(true);
    try {
      await BackgroundGeolocation.requestIgnoreBatteryOptimizations();
    } catch (err) {
      console.error("requestIgnoreBatteryOptimizations failed:", err);
    } finally {
      setRequesting(false);
      // Re-check shortly after — the rider may accept/decline the system
      // dialog and return immediately, before appStateChange fires reliably.
      setTimeout(checkStatus, 800);
    }
  };

  const handleOpenSettings = async () => {
    try {
      await BackgroundGeolocation.openSettings();
    } catch (err) {
      console.error("openSettings failed:", err);
    }
  };

  const dismissBanner = () => {
    setBannerDismissed(true);
    if (typeof window !== "undefined") {
      sessionStorage.setItem(SESSION_DISMISS_KEY, "true");
    }
  };

  if (status !== "needs-setup" || bannerDismissed) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        className="w-full flex items-center gap-3 rounded-2xl border-2 border-amber-200 bg-amber-50 p-4 text-left shadow-sm transition-colors hover:bg-amber-100"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600">
          <BatteryWarning className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-black text-amber-900">
            Fix location tracking before your shift
          </p>
          <p className="text-xs font-medium text-amber-700 mt-0.5">
            Your phone may stop sharing your location when the screen is
            locked. Tap to fix it (takes 1 minute).
          </p>
        </div>
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            dismissBanner();
          }}
          className="text-xs font-bold text-amber-500 hover:text-amber-700 shrink-0"
        >
          Later
        </span>
      </button>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-green-600" />
              Keep tracking alive
            </DialogTitle>
            <DialogDescription>
              Delivery riders drive with the screen locked for long stretches.
              Your phone&apos;s battery saver can quietly stop location
              updates unless you allow this app to run in the background.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-xl border bg-muted/40 p-3">
              <p className="text-sm font-bold text-zinc-900 mb-2">
                Step 1 — Android battery permission
              </p>
              <p className="text-xs text-zinc-500 mb-3">
                Tap below and choose &quot;Allow&quot; / &quot;Don&apos;t
                optimize&quot; on the prompt.
              </p>
              <Button
                onClick={handleRequestExemption}
                disabled={requesting}
                className="w-full"
                size="sm"
              >
                {requesting ? "Opening…" : "Allow background location"}
              </Button>
            </div>

            {oem && oem.key !== "other" ? (
              <div className="rounded-xl border bg-muted/40 p-3">
                <p className="text-sm font-bold text-zinc-900 mb-1">
                  Step 2 — {oem.brandLabel} phone settings
                </p>
                <p className="text-xs text-zinc-500 mb-3">{oem.summary}</p>
                <ol className="space-y-2">
                  {oem.steps.map((s, i) => (
                    <li key={i} className="flex gap-2 text-xs text-zinc-700">
                      <span className="shrink-0 font-black text-zinc-400">
                        {i + 1}.
                      </span>
                      <span>{s.step}</span>
                    </li>
                  ))}
                </ol>
                <Button
                  onClick={handleOpenSettings}
                  variant="outline"
                  size="sm"
                  className="w-full mt-3"
                >
                  Open App Settings
                </Button>
              </div>
            ) : (
              <div className="rounded-xl border bg-muted/40 p-3">
                <p className="text-sm font-bold text-zinc-900 mb-1">
                  Step 2 — Check your phone&apos;s battery settings
                </p>
                <p className="text-xs text-zinc-500 mb-3">{oem?.summary}</p>
                <Button
                  onClick={handleOpenSettings}
                  variant="outline"
                  size="sm"
                  className="w-full"
                >
                  Open App Settings
                </Button>
              </div>
            )}
          </div>

          <DialogFooter showCloseButton>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                checkStatus();
              }}
            >
              I&apos;ve done this — recheck
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
