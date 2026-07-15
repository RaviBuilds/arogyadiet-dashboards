import Image from "next/image";
import { Sparkles } from "lucide-react";

/**
 * TransformationSpotlight — the motivation zone. Uses ArogyaDiet's real
 * transformation imagery to reinforce the brand's core promise: transformation.
 * Placed once, strategically, below the daily task so it inspires without
 * distracting. Reusable across every customer type.
 *
 * The overlay uses a layered scrim (directional gradient + bottom gradient +
 * subtle text shadow) so the copy stays crisply legible over any photo.
 */
type TransformationSpotlightProps = {
  imageSrc: string;
  headline: string;
  subtext: string;
  imageAlt?: string;
};

export function TransformationSpotlight({
  imageSrc,
  headline,
  subtext,
  imageAlt = "A real ArogyaDiet transformation journey",
}: TransformationSpotlightProps) {
  return (
    <section className="relative min-h-[13rem] overflow-hidden rounded-3xl border border-emerald-900/10 shadow-sm sm:min-h-[15rem]">
      <Image
        src={imageSrc}
        alt={imageAlt}
        fill
        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 90vw, 1024px"
        className="object-cover object-center"
      />
      {/* Layered scrim for legibility: strong on the left/bottom where the copy
          sits, fading to reveal the photo on the right. */}
      <div className="absolute inset-0 bg-gradient-to-r from-emerald-950/90 via-emerald-950/60 to-emerald-950/10" />
      <div className="absolute inset-0 bg-gradient-to-t from-emerald-950/70 via-transparent to-transparent" />

      <div className="relative flex h-full min-h-[13rem] max-w-lg flex-col justify-center p-6 sm:min-h-[15rem] sm:p-8">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-white ring-1 ring-inset ring-white/25 backdrop-blur-sm">
          <Sparkles className="h-3.5 w-3.5" />
          Real transformations
        </span>
        <h3
          className="mt-4 text-xl font-semibold leading-snug tracking-tight text-white sm:text-2xl"
          style={{ textShadow: "0 1px 12px rgba(0,0,0,0.35)" }}
        >
          {headline}
        </h3>
        <p
          className="mt-2 max-w-md text-sm leading-relaxed text-white/90"
          style={{ textShadow: "0 1px 8px rgba(0,0,0,0.3)" }}
        >
          {subtext}
        </p>
      </div>
    </section>
  );
}
