import Image from "next/image";

/**
 * AppLoader — the branded "entering ArogyaDiet" moment for the whole app.
 *
 * One cohesive direction: a gently breathing wordmark over a soft morning
 * glow, with calm halo rings that breathe outward from the mark so it feels
 * alive and radiant rather than like a waiting spinner. A short line of
 * reassuring copy sits beneath. Reused by the initial-load overlay and by
 * per-page loading fallbacks so every screen feels like the same product.
 *
 * All motion is CSS and GPU-friendly (transform / opacity) and disabled under
 * prefers-reduced-motion. Nudged slightly above true centre so the cluster
 * feels composed, not floating.
 */
export function AppLoader({
  message = "Preparing your healthy day…",
}: {
  message?: string;
}) {
  return (
    <div className="app-loader-fadein flex -translate-y-[4%] flex-col items-center">
      <div className="relative flex h-40 w-40 items-center justify-center">
        {/* Soft morning glow (smooth radial — no blur banding) */}
        <span
          aria-hidden="true"
          className="app-loader-glow pointer-events-none absolute h-40 w-40 rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgba(16,185,129,0.24) 0%, rgba(16,185,129,0.10) 42%, rgba(16,185,129,0) 70%)",
          }}
        />
        {/* Breathing halo rings, staggered */}
        <span
          aria-hidden="true"
          className="app-halo pointer-events-none absolute h-32 w-32 rounded-full border border-emerald-400/40"
        />
        <span
          aria-hidden="true"
          className="app-halo app-halo-delayed pointer-events-none absolute h-32 w-32 rounded-full border border-emerald-400/40"
        />
        {/* Wordmark, at its true 776×321 aspect (never squished) */}
        <Image
          src="/logo.png"
          alt="ArogyaDiet"
          width={776}
          height={321}
          priority
          className="app-loader-logo relative h-[72px] w-auto object-contain"
        />
      </div>

      <p className="mt-7 text-[15px] font-medium tracking-wide text-emerald-900/80">
        {message}
      </p>
    </div>
  );
}
