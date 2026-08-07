// src/app/customer/(public)/app/[slug]/_components/theme.ts
// Per-slug brand tokens for the download pages.
//
// The visual language is lifted from the customer login brand panel
// (`src/app/customer/(auth)/login/LoginBrandPanel.tsx`): a deep forest-green
// gradient, ambient glow wells, low-opacity botanical line art, `font-display`
// headline and glass pills with a hairline ring. The rider page carries the
// same grammar in the delivery-partner red/amber palette so the two portals
// read as one product family — exactly how the two login screens relate.
//
// Tokens are plain Tailwind class strings rather than CSS variables so every
// value stays statically analysable by the Tailwind compiler.

import type { AppSlug } from "@/lib/appDistribution/slug";

export interface AppTheme {
  /** Full-bleed page gradient. */
  pageGradient: string;
  /** Ambient glow wells, rendered in order (top-left, bottom-right, centre). */
  glows: readonly [string, string, string];
  /** Botanical line-art tint. */
  lineArt: string;
  /** Accent text colour for eyebrow copy, icons and the headline's last line. */
  accentText: string;
  /** Body copy colour on the dark panel. */
  bodyText: string;
  /** Muted/secondary copy colour on the dark panel. */
  mutedText: string;
  /**
   * Recolours the `DownloadControl` client leaf for the dark panel.
   *
   * Applied as arbitrary child variants on a wrapper rather than as props, so
   * the control keeps its own state machine and markup untouched. The generated
   * rules are descendant selectors, which out-specify the component's own
   * single-class utilities — that is what lets the button override `bg-primary`.
   *
   * Must be a complete static string: Tailwind cannot see through interpolation.
   */
  controlChrome: string;
  /** Halo behind the phone mockup. */
  mockupHalo: string;
}

/**
 * Shared button geometry for the download control.
 *
 * A 3.25rem tap target on mobile, comfortably above the 44px minimum, because
 * this button is the entire point of the page for a visitor who just scanned a
 * QR code on their phone.
 */
const BUTTON_SHAPE = [
  "[&_button]:h-13 [&_button]:w-full [&_button]:rounded-xl",
  "[&_button]:text-base [&_button]:font-semibold",
  "[&_button]:shadow-lg [&_button]:shadow-black/20",
].join(" ");

const CUSTOMER_THEME: AppTheme = {
  // Vertical on mobile, diagonal from `lg`: a tall phone page stretches a
  // diagonal gradient into visible banding down one edge.
  pageGradient:
    "bg-gradient-to-b from-emerald-950 via-emerald-900 to-emerald-800 lg:bg-gradient-to-br",
  glows: [
    "bg-emerald-400/30",
    "bg-amber-300/20",
    "bg-lime-300/20",
  ],
  lineArt: "text-emerald-200/[0.16]",
  accentText: "text-emerald-300",
  bodyText: "text-emerald-50/80",
  mutedText: "text-emerald-50/60",
  controlChrome: [
    "[&_p]:text-emerald-50/70",
    BUTTON_SHAPE,
    "[&_button]:bg-white [&_button]:text-emerald-950",
    "[&_button:hover:not(:disabled)]:bg-emerald-50",
    "[&_button:disabled]:bg-white/70 [&_button:disabled]:text-emerald-950",
  ].join(" "),
  mockupHalo: "bg-emerald-400/20",
};

const RIDER_THEME: AppTheme = {
  pageGradient:
    "bg-gradient-to-b from-red-950 via-red-900 to-amber-900 lg:bg-gradient-to-br",
  glows: ["bg-red-400/25", "bg-amber-300/25", "bg-orange-300/20"],
  lineArt: "text-amber-200/[0.14]",
  accentText: "text-amber-300",
  bodyText: "text-amber-50/80",
  mutedText: "text-amber-50/60",
  controlChrome: [
    "[&_p]:text-amber-50/70",
    BUTTON_SHAPE,
    "[&_button]:bg-white [&_button]:text-red-950",
    "[&_button:hover:not(:disabled)]:bg-amber-50",
    "[&_button:disabled]:bg-white/70 [&_button:disabled]:text-red-950",
  ].join(" "),
  mockupHalo: "bg-amber-400/20",
};

export const APP_THEME: Record<AppSlug, AppTheme> = {
  customer: CUSTOMER_THEME,
  rider: RIDER_THEME,
};
