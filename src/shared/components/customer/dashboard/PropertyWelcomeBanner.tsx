import { Leaf, MapPin } from "lucide-react";
import { RotatingFoodImage } from "./RotatingFoodImage";

/**
 * PropertyWelcomeBanner — a branded "arrival" moment for the Accommodation
 * dashboard, built from real Arogya Gramam photography (the farmhouse
 * entrance gate and an aerial view of the villas and gardens) instead of
 * decorative illustration or stock imagery.
 *
 * The two photos cross-fade using the same RotatingFoodImage mechanic the
 * meal dashboard already uses for its food photography — reusing an
 * existing, proven motion pattern rather than inventing a new one — so the
 * banner tells a small two-beat story: "this is the gate you'll walk
 * through" → "this is the garden you'll be staying in".
 *
 * Sits right after the journey hero, before Today's focus — the same beat a
 * TransformationSpotlight banner occupies on the meal dashboard — so the
 * customer gets a sense of place before the page moves on to numbers and
 * dates.
 */
type PropertyWelcomeBannerProps = {
  images: string[];
  propertyName?: string;
  tagline?: string;
  /** Small floating chip, e.g. the customer's stay type ("AC Villa"). */
  stayTypeLabel?: string | null;
};

export function PropertyWelcomeBanner({
  images,
  propertyName = "Arogya Gramam",
  tagline = "Your gateway to nature, nourishment and rest.",
  stayTypeLabel,
}: PropertyWelcomeBannerProps) {
  return (
    <section
      className="reveal-rise relative overflow-hidden rounded-3xl border border-emerald-900/10 shadow-sm"
      style={{ ["--reveal-delay" as string]: "700ms" }}
    >
      <div className="relative h-52 w-full sm:h-64 md:h-72">
        <RotatingFoodImage
          images={images}
          alt={`${propertyName} — entrance and grounds`}
          intervalMs={6000}
          sizes="(max-width: 1024px) 100vw, 1024px"
        />

        {/* Grounding gradient so the white copy always reads cleanly,
            darkest along the bottom where the text sits. */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent" />

        {stayTypeLabel ? (
          <span className="absolute right-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-emerald-800 shadow-sm backdrop-blur-sm">
            <MapPin className="h-3.5 w-3.5" />
            {stayTypeLabel}
          </span>
        ) : null}

        <div className="absolute inset-x-0 bottom-0 p-5 sm:p-7">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-emerald-50 ring-1 ring-inset ring-white/25">
            <Leaf className="h-3.5 w-3.5" />
            Welcome to
          </span>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            {propertyName}
          </h2>
          <p className="mt-1 max-w-md text-sm leading-relaxed text-emerald-50/90">
            {tagline}
          </p>
        </div>
      </div>
    </section>
  );
}
