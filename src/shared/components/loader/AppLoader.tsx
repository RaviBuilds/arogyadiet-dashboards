import Image from "next/image";

/**
 * AppLoader — the branded loading centrepiece for the whole ArogyaDiet app.
 *
 * Presentational only (no state): the wordmark logo (sized to its true 776×321
 * aspect so it never squishes) resting over a smooth layered leaf-light halo,
 * a calm indeterminate flowing line (a soft segment rather than a fake
 * 0→100% bar), and a short line of reassuring copy. Reused by the initial-load
 * overlay and by per-page loading fallbacks so every screen feels like the
 * same product.
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

      {/* Calm indeterminate progress line */}
      <div className="relative mt-5 h-1.5 w-44 overflow-hidden rounded-full bg-emerald-100">
        <div className="app-loader-line absolute inset-y-0 left-0 w-2/5 rounded-full bg-gradient-to-r from-emerald-400 via-emerald-500 to-lime-400 shadow-[0_0_8px_rgba(16,185,129,0.35)]" />
      </div>
    </div>
  );
}
