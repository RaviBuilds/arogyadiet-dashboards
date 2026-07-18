"use client";

/**
 * RiderTrackingSetup
 *
 * Single, unified setup flow for everything live GPS tracking needs to survive
 * a real shift (screen locked, app backgrounded). Replaces the two separate
 * banners (location permission + battery) that confused riders.
 *
 * It presents an ordered checklist with a live status for each item:
 *   1. Location — "Allow all the time"   (auto-verified)
 *   2. Notifications                       (auto-verified)
 *   3. Battery — don't optimise (stock)    (auto-verified)
 *   4. Phone-maker battery settings (Vivo/Xiaomi/…) — manual, can't be detected
 *
 * Behaviour:
 * - Native only (renders nothing on web).
 * - A compact amber banner shows while setup is incomplete, with progress
 *   ("2 of 3 done"). Tapping it opens the full checklist dialog.
 * - Each auto-verifiable step shows a green tick once granted, or an action
 *   button that fires the correct system prompt (and falls back to App Settings
 *   if the OS silently denies, e.g. a twice-denied permission).
 * - Statuses re-check automatically when the app returns to the foreground and
 *   via an explicit "Re-check" button, so ticks appear without a manual reload.
 * - When everything is done the banner disappears; opening the dialog then
 *   shows an "You're all set" state (OEM tips stay accessible).
 * - The banner is dismissible for the session ("Later") but returns next open
 *   until setup is actually complete.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
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
import {
  BatteryCharging,
  Bell,
  CheckCircle2,
  ChevronRight,
  MapPin,
  RefreshCw,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { cn } from "@/lib/utils";

const SESSION_DISMISS_KEY = "rider_tracking_setup_dismissed";
const OEM_ACK_KEY = "rider_tracking_oem_ack";

type Grant = "granted" | "denied";

interface SetupState {
  location: Grant; // "Allow all the time" background location
  notifications: Grant;
  battery: Grant; // stock Android battery-optimisation exemption
  manufacturer: string;
}

const ALL_GRANTED: SetupState = {
  location: "granted",
  notifications: "granted",
  battery: "granted",
  manufacturer: "",
};

export function RiderTrackingSetup() {
  const [state, setState] = useState<SetupState | null>(null);
  const [oem, setOem] = useState<OemInstructions | null>(null);
  const [checking, setChecking] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [busyStep, setBusyStep] = useState<string | null>(null);
  const [oemAck, setOemAck] = useState(false);

  const refresh = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) {
      setState(ALL_GRANTED);
      setChecking(false);
      return;
    }
    try {
      const [perms, battery] = await Promise.all([
        BackgroundGeolocation.getTrackingPermissionStatus(),
        BackgroundGeolocation.getBatteryOptimizationStatus(),
      ]);
      setOem(getOemInstructions(battery.manufacturer));
      setState({
        location: perms.backgroundLocation,
        notifications: perms.notifications,
        battery: battery.isIgnoringBatteryOptimizations ? "granted" : "denied",
        manufacturer: battery.manufacturer,
      });
    } catch (err) {
      // Old APK without the new methods → fail open so the rider is never
      // blocked by an unusable banner.
      console.error("[RiderTrackingSetup] status check failed:", err);
      setState(ALL_GRANTED);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    if (typeof window !== "undefined") {
      setBannerDismissed(sessionStorage.getItem(SESSION_DISMISS_KEY) === "true");
      setOemAck(localStorage.getItem(OEM_ACK_KEY) === "true");
    }
    if (!Capacitor.isNativePlatform()) return;
    const listener = CapacitorApp.addListener("appStateChange", (s) => {
      if (s.isActive) refresh();
    });
    return () => {
      listener.then((h) => h.remove());
    };
  }, [refresh]);

  const runStep = useCallback(
    async (
      key: string,
      request: () => Promise<unknown>,
      wasGranted: () => boolean,
    ) => {
      setBusyStep(key);
      try {
        await request();
        await refresh();
        // If the OS silently refused (e.g. permission denied twice, or Android
        // 11+ routing background location to Settings), guide to App Settings.
        if (!wasGranted()) {
          await BackgroundGeolocation.openSettings();
        }
      } catch (err) {
        console.error(`[RiderTrackingSetup] step "${key}" failed:`, err);
      } finally {
        setBusyStep(null);
        setTimeout(refresh, 800);
      }
    },
    [refresh],
  );

  const requestLocation = () =>
    runStep(
      "location",
      () => BackgroundGeolocation.requestBackgroundLocationPermission(),
      () => false, // always re-check via refresh; openSettings fallback if still denied
    );

  const requestNotifications = () =>
    runStep(
      "notifications",
      () => BackgroundGeolocation.requestNotificationPermission(),
      () => false,
    );

  const requestBattery = () =>
    runStep(
      "battery",
      () => BackgroundGeolocation.requestIgnoreBatteryOptimizations(),
      () => false,
    );

  const openSettings = async () => {
    try {
      await BackgroundGeolocation.openSettings();
    } catch (err) {
      console.error("[RiderTrackingSetup] openSettings failed:", err);
    }
  };

  const acknowledgeOem = () => {
    setOemAck(true);
    if (typeof window !== "undefined") {
      localStorage.setItem(OEM_ACK_KEY, "true");
    }
  };

  const dismissBanner = () => {
    setBannerDismissed(true);
    if (typeof window !== "undefined") {
      sessionStorage.setItem(SESSION_DISMISS_KEY, "true");
    }
  };

  if (checking || !state) return null;

  const coreDone =
    state.location === "granted" &&
    state.notifications === "granted" &&
    state.battery === "granted";

  const doneCount =
    (state.location === "granted" ? 1 : 0) +
    (state.notifications === "granted" ? 1 : 0) +
    (state.battery === "granted" ? 1 : 0);

  const hasOemSteps = !!oem && oem.key !== "other";

  // Nothing to nag about once the core auto-verifiable steps are done.
  if (coreDone && bannerDismissed) return null;

  return (
    <>
      {!coreDone && !bannerDismissed ? (
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="w-full flex items-center gap-3 rounded-2xl border-2 border-amber-200 bg-amber-50 p-4 text-left shadow-sm transition-colors hover:bg-amber-100"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-black text-amber-900">
              Finish tracking setup ({doneCount}/3)
            </p>
            <p className="text-xs font-medium text-amber-700 mt-0.5">
              A few quick permissions so your location keeps sharing when your
              screen is locked. Tap to finish.
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
      ) : null}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-green-600" />
              {coreDone ? "You're all set" : "Set up live tracking"}
            </DialogTitle>
            <DialogDescription>
              {coreDone
                ? "Your location will keep sharing with the clinic while you're On Duty — even with the screen locked."
                : "Delivery riders drive with the screen locked. Grant these so your location keeps sharing in the background."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2.5">
            <StepRow
              icon={<MapPin className="h-5 w-5" />}
              title='Location: "Allow all the time"'
              subtitle='Choose "Allow all the time" — not "While using" or "Only this time".'
              done={state.location === "granted"}
              busy={busyStep === "location"}
              onAction={requestLocation}
              actionLabel="Allow"
            />
            <StepRow
              icon={<Bell className="h-5 w-5" />}
              title="Notifications"
              subtitle="Shows the ongoing tracking status and helps keep tracking alive."
              done={state.notifications === "granted"}
              busy={busyStep === "notifications"}
              onAction={requestNotifications}
              actionLabel="Allow"
            />
            <StepRow
              icon={<BatteryCharging className="h-5 w-5" />}
              title="Battery: don't optimise"
              subtitle={`On the prompt, choose "Allow" / "Don't optimize".`}
              done={state.battery === "granted"}
              busy={busyStep === "battery"}
              onAction={requestBattery}
              actionLabel="Allow"
            />

            {hasOemSteps ? (
              <div className="rounded-xl border bg-muted/40 p-3">
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                      oemAck
                        ? "bg-green-100 text-green-600"
                        : "bg-zinc-100 text-zinc-500",
                    )}
                  >
                    {oemAck ? (
                      <CheckCircle2 className="h-5 w-5" />
                    ) : (
                      <Smartphone className="h-5 w-5" />
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-bold text-zinc-900">
                      {oem!.brandLabel} battery settings
                    </p>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      {oem!.summary}
                    </p>
                  </div>
                </div>

                <ol className="mt-3 space-y-2">
                  {oem!.steps.map((s, i) => (
                    <li key={i} className="flex gap-2 text-xs text-zinc-700">
                      <span className="shrink-0 font-black text-zinc-400">
                        {i + 1}.
                      </span>
                      <span>{s.step}</span>
                    </li>
                  ))}
                </ol>

                <div className="mt-3 flex gap-2">
                  <Button
                    onClick={openSettings}
                    variant="outline"
                    size="sm"
                    className="flex-1"
                  >
                    Open App Settings
                  </Button>
                  {!oemAck ? (
                    <Button
                      onClick={acknowledgeOem}
                      variant="secondary"
                      size="sm"
                      className="flex-1"
                    >
                      I&apos;ve done this
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          <DialogFooter showCloseButton>
            <Button
              variant="ghost"
              size="sm"
              onClick={refresh}
              className="gap-1.5"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Re-check
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function StepRow({
  icon,
  title,
  subtitle,
  done,
  busy,
  onAction,
  actionLabel,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  done: boolean;
  busy: boolean;
  onAction: () => void;
  actionLabel: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border p-3 transition-colors",
        done ? "border-green-200 bg-green-50" : "bg-muted/40",
      )}
    >
      <div
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
          done ? "bg-green-100 text-green-600" : "bg-zinc-100 text-zinc-500",
        )}
      >
        {done ? <CheckCircle2 className="h-5 w-5" /> : icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-zinc-900">{title}</p>
        {!done ? (
          <p className="text-xs text-zinc-500 mt-0.5">{subtitle}</p>
        ) : (
          <p className="text-xs font-medium text-green-700 mt-0.5">Done</p>
        )}
      </div>
      {!done ? (
        <Button
          onClick={onAction}
          disabled={busy}
          size="sm"
          className="shrink-0 gap-1"
        >
          {busy ? "Opening…" : actionLabel}
          {!busy ? <ChevronRight className="h-3.5 w-3.5" /> : null}
        </Button>
      ) : null}
    </div>
  );
}
