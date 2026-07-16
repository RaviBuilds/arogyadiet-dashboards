import Image from "next/image";
import { Leaf } from "lucide-react";

/**
 * AppLoader — the branded loading centrepiece for the whole ArogyaDiet app.
 *
 * Presentational only (no state): the wordmark logo (sized to its true 776×321
 * aspect so it never squishes) resting over a smooth layered leaf-light halo,
 * a short line of reassuring copy, and — instead of a generic bar or spinner —
 * a signature "orbiting leaf": a small leaf glides slowly around a soft ring
 * (staying upright as it travels). It's unmistakably ArogyaDiet, echoes the
 * dashboard's circular journey ring rather than duplicating its horizontal
 * bar, and stays calm rather than busy.
 *
 * All motion is CSS and GPU-friendly (transform / opacity) and is disabled
 * under prefers-reduced-motion. Nudged to optical centre (slightly above true
 * centre) so the cluster feels composed rather than floating.
 */
export function AppLoader({
  message = "Preparing your healthy day…",
}: {
  message?: string;
}) {
  return (
    <div className="app-loader-fadein flex -translate-y-[3%] flex-col items-center">
      <div className="relative flex items-center justify-center">
        {/* Smooth layered leaf-light halo (radial gradients — no blur banding) */}
        <span
          aria-hidden="true"
          className="app-loader-glow pointer-events-none absolute h-72 w-72 rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgba(16,185,129,0.26) 0%, rgba(16,185,129,0.12) 40%, rgba(16,185,129,0) 70%)",
          }}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute h-40 w-40 rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgba(190,242,100,0.22) 0%, rgba(190,242,100,0) 68%)",
          }}
        />
        <Image
          src="/logo.png"
          alt="ArogyaDiet"
          width={776}
          height={321}
          priority
          className="app-loader-logo relative h-[76px] w-auto object-contain"
        />
      </div>

      <p className="mt-8 text-[15px] font-medium tracking-wide text-emerald-900/80">
        {message}
      </p>

      {/* Signature indeterminate indicator: a leaf orbiting a soft ring */}
      <div className="relative mt-7 h-12 w-12">
        {/* Soft breathing halo */}
        <span
          aria-hidden="true"
          className="app-orbit-pulse absolute inset-0 rounded-full bg-emerald-400/10"
        />
        {/* Faint track the leaf travels along */}
        <span
          aria-hidden="true"
          className="absolute inset-[6px] rounded-full border border-emerald-200/70"
        />
        {/* Orbiting layer */}
        <span
          aria-hidden="true"
          className="app-orbit absolute inset-0 flex items-center justify-center"
        >
          {/* Radius offset — this point orbits the centre */}
          <span className="block -translate-y-[18px]">
            {/* Counter-rotation keeps the leaf token upright as it travels */}
            <span className="app-orbit-counter flex h-[18px] w-[18px] items-center justify-center rounded-full bg-white shadow-[0_1px_5px_rgba(16,185,129,0.45)]">
              <Leaf className="h-2.5 w-2.5 fill-emerald-500/20 text-emerald-600" />
            </span>
          </span>
        </span>
      </div>
    </div>
  );
}
