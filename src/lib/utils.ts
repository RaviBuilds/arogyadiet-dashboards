import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// The design system adds two custom font-family utilities on top of Tailwind's
// defaults — `font-heading` and `font-display` (see @theme in globals.css).
// tailwind-merge doesn't know these belong to the font-family group, so a
// combination like `cn("font-heading", "font-display")` (which happens when a
// component such as CardTitle ships `font-heading` and a caller adds
// `font-display`) would keep BOTH classes and let CSS source order decide the
// winner non-deterministically. Registering them here makes the LAST one win,
// as expected everywhere else in Tailwind.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-family": [{ font: ["heading", "display"] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
