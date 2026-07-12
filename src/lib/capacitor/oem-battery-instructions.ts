/**
 * OEM-specific "don't kill my app" instructions.
 *
 * Stock Android's battery-optimization exemption (requested via
 * requestIgnoreBatteryOptimizations) is necessary but NOT sufficient on most
 * Chinese OEM skins. Vivo (FuntouchOS), Xiaomi (MIUI), Oppo/Realme (ColorOS),
 * and OnePlus (OxygenOS/ColorOS) layer their own power-management daemons on
 * top of stock Android, and those have no public API — Google's battery
 * exemption is invisible to them. The rider must be walked through the
 * OEM-specific screen manually.
 *
 * This is a well-documented, widely-known Android fragmentation problem
 * (see https://dontkillmyapp.com for the community-maintained reference this
 * list is modeled on). There is no code fix for it — only user education.
 *
 * Verified in production testing (2026-07-12): a Vivo V2031 device killed the
 * foreground service ~7-9 minutes into deep Doze with ONLY the stock Android
 * exemption granted. Additionally granting the iManager-level "Unrestricted"
 * battery toggle (distinct from the Settings app toggle) allowed it to survive
 * 18+ minutes without interruption.
 */

export type OemKey =
  | "vivo"
  | "xiaomi"
  | "oppo"
  | "realme"
  | "oneplus"
  | "samsung"
  | "other";

export interface OemInstructionStep {
  step: string;
}

export interface OemInstructions {
  key: OemKey;
  brandLabel: string;
  /** Short summary shown at the top of the card. */
  summary: string;
  /** Ordered manual steps the rider must follow in their phone Settings. */
  steps: OemInstructionStep[];
}

const INSTRUCTIONS: Record<OemKey, OemInstructions> = {
  vivo: {
    key: "vivo",
    brandLabel: "Vivo",
    summary:
      "Vivo phones have TWO separate battery controls. Both must be set, or tracking will stop after a few minutes when your screen is off.",
    steps: [
      { step: "Open the i Manager app (usually on your home screen)." },
      { step: "Go to App manager → Autostart, find ArogyaDiet Rider, and turn it ON." },
      {
        step:
          "Go to i Manager → Battery → High background power consumption (or Background power consumption management).",
      },
      { step: "Find ArogyaDiet Rider and set it to Allow / Unrestricted / No restrictions." },
      {
        step:
          "Also open Settings → Battery → App battery usage → ArogyaDiet Rider, and set it to Unrestricted (this is a separate toggle from i Manager).",
      },
    ],
  },
  xiaomi: {
    key: "xiaomi",
    brandLabel: "Xiaomi / Redmi / POCO",
    summary:
      "MIUI aggressively kills background apps by default. You must enable Autostart and remove battery restrictions.",
    steps: [
      { step: "Open Settings → Apps → Manage apps → ArogyaDiet Rider." },
      { step: "Tap Autostart and turn it ON." },
      { step: "Tap Battery saver and set it to No restrictions." },
      {
        step:
          "Open Security app → Battery → App battery saver → ArogyaDiet Rider → No restrictions.",
      },
      {
        step:
          "If available, also disable MIUI Optimization under Developer options (Settings → About phone → tap MIUI version 7 times to unlock Developer options).",
      },
    ],
  },
  oppo: {
    key: "oppo",
    brandLabel: "Oppo",
    summary:
      "ColorOS restricts background apps unless you explicitly allow this app to run and start automatically.",
    steps: [
      { step: "Open Settings → Battery → App Battery Management." },
      { step: "Find ArogyaDiet Rider and set it to Allow background activity." },
      { step: "Open Settings → Apps → App list → ArogyaDiet Rider → Allow auto launch." },
      {
        step:
          "Open the phone Manager app → Privacy permissions → Startup manager, and enable auto-start for ArogyaDiet Rider.",
      },
    ],
  },
  realme: {
    key: "realme",
    brandLabel: "Realme",
    summary:
      "Realme uses the same ColorOS-based restrictions as Oppo. Both auto-start and background battery permissions are required.",
    steps: [
      { step: "Open Settings → Battery → App Battery Management." },
      { step: "Find ArogyaDiet Rider and set it to Allow background activity." },
      { step: "Open Settings → App management → App list → ArogyaDiet Rider → Allow auto launch." },
      { step: "Open Phone Manager → Permission privacy → Startup manager, and enable it for ArogyaDiet Rider." },
    ],
  },
  oneplus: {
    key: "oneplus",
    brandLabel: "OnePlus",
    summary:
      "OxygenOS can restrict background battery usage. Set the app to unrestricted so tracking continues with the screen off.",
    steps: [
      { step: "Open Settings → Battery → Battery optimization." },
      { step: "Find ArogyaDiet Rider and set it to Don't optimize." },
      {
        step:
          "Open Settings → Apps → ArogyaDiet Rider → Battery → Background usage, and set it to Unrestricted / Allow.",
      },
    ],
  },
  samsung: {
    key: "samsung",
    brandLabel: "Samsung",
    summary:
      "One Ui puts unused apps to sleep in the background. Add ArogyaDiet Rider to the Never sleeping apps list.",
    steps: [
      { step: "Open Settings → Apps → ArogyaDiet Rider → Battery." },
      { step: "Set Battery usage to Unrestricted." },
      {
        step:
          "Open Settings → Battery and device care → Battery → Background usage limits → Never sleeping apps, and add ArogyaDiet Rider.",
      },
    ],
  },
  other: {
    key: "other",
    brandLabel: "Your phone",
    summary:
      "Look for battery or power-saving settings for this app and set them to unrestricted / no restrictions / allow background activity.",
    steps: [
      { step: "Open Settings → Battery (or Apps → ArogyaDiet Rider → Battery)." },
      { step: "Set battery usage / optimization for ArogyaDiet Rider to Unrestricted or No restrictions." },
      {
        step:
          "If your phone has an app manager (Security app, Phone Manager, i Manager), also enable Autostart / Auto-launch for ArogyaDiet Rider there.",
      },
    ],
  },
};

/**
 * Maps the raw Android Build.MANUFACTURER string (lowercase on device) to
 * our instruction set. Falls back to "other" for unrecognized brands.
 */
export function resolveOemKey(manufacturer: string | null | undefined): OemKey {
  const m = (manufacturer || "").toLowerCase();
  if (m.includes("vivo")) return "vivo";
  if (m.includes("xiaomi") || m.includes("redmi") || m.includes("poco")) return "xiaomi";
  if (m.includes("realme")) return "realme"; // check before oppo (realme spun off from oppo)
  if (m.includes("oppo")) return "oppo";
  if (m.includes("oneplus")) return "oneplus";
  if (m.includes("samsung")) return "samsung";
  return "other";
}

export function getOemInstructions(manufacturer: string | null | undefined): OemInstructions {
  return INSTRUCTIONS[resolveOemKey(manufacturer)];
}
