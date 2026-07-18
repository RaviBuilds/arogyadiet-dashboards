"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  ChevronLeft,
  ChevronRight,
  Play,
  Sparkles,
  BadgeCheck,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * TransformationStories — "Today's Inspiration".
 *
 * This is the emotional payoff of the Meals page story arc (Nutrition
 * Journey → Meal Journey → Inspiration → History): after showing today's
 * progress, it hands the customer proof that the destination is real. The
 * testimonial JPEGs are finished marketing creatives (photo + name + result
 * + duration + branding baked in) — never cropped, never overlaid with
 * competing text, always shown in full via `object-contain` inside a
 * premium floating frame, exactly like a poster in a gallery.
 *
 * Interaction model: auto-rotates every `INTERVAL_MS`, pausing on hover/
 * focus, hidden tab, or when scrolled off-screen. Supports arrow-key
 * navigation, touch swipe, and click-to-jump pill indicators. Respects
 * prefers-reduced-motion throughout (fade/scale + progress-fill animations
 * are skipped; see `.story-progress-fill` in globals.css).
 */
const STORY_IMAGES = [
  "/testimonail-1.jpeg",
  "/testimonail-2.jpeg",
  "/testimonail-3.jpeg",
  "/testimonail-4.jpeg",
  "/testimonail-5.jpeg",
];

const INTERVAL_MS = 5000;

export function TransformationStories({
  youtubeId = "yzqZ-yTll8M",
  youtubeStart = 8,
}: {
  youtubeId?: string;
  youtubeStart?: number;
}) {
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const [isHovered, setIsHovered] = useState(false);
  const [isTabHidden, setIsTabHidden] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const touchStartXRef = useRef<number | null>(null);

  const goTo = useCallback((next: number) => {
    const total = STORY_IMAGES.length;
    setIndex(((next % total) + total) % total);
  }, []);

  // Pause when the card scrolls off-screen.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      { threshold: 0.2 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Track tab visibility (used both to gate the timer and to visually pause
  // the per-slide progress-fill animation so it never silently drifts out
  // of sync with what's actually advancing).
  useEffect(() => {
    const handleVisibility = () => setIsTabHidden(document.hidden);
    handleVisibility();
    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  const paused = isTabHidden || !isVisible || isHovered;

  // Auto-advance — paused when the tab is hidden, the card is off-screen, or
  // the customer is hovering/focused on it. Skipped for reduced-motion.
  useEffect(() => {
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) return;

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (paused) return;

    timerRef.current = setInterval(() => {
      setIndex((i) => (i + 1) % STORY_IMAGES.length);
    }, INTERVAL_MS);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [paused]);

  // Keyboard support — left/right arrows move between slides while the
  // carousel frame (or anything inside it) has focus.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goTo(index - 1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goTo(index + 1);
      }
    },
    [goTo, index],
  );

  // Touch swipe support for mobile.
  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    touchStartXRef.current = e.touches[0]?.clientX ?? null;
  };
  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    const startX = touchStartXRef.current;
    const endX = e.changedTouches[0]?.clientX;
    touchStartXRef.current = null;
    if (startX == null || endX == null) return;
    const delta = endX - startX;
    if (Math.abs(delta) < 40) return;
    if (delta < 0) goTo(index + 1);
    else goTo(index - 1);
  };

  const embedSrc = `https://www.youtube.com/embed/${youtubeId}?start=${youtubeStart}&autoplay=1&rel=0&modestbranding=1`;

  return (
    <section
      ref={containerRef}
      className="reveal-rise relative isolate overflow-hidden rounded-3xl border border-emerald-950/15 bg-gradient-to-br from-emerald-950 via-emerald-900 to-emerald-800 p-6 shadow-[0_30px_70px_-30px_rgba(4,40,26,0.55)] sm:p-8 lg:p-10"
      style={{ ["--reveal-delay" as string]: "900ms" }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={() => setIsHovered(true)}
      onBlur={() => setIsHovered(false)}
    >
      {/* ── Deep forest backdrop — deliberately darker/richer than the mint
             cards above it (Nutrition Journey, Meal Journey) so this section
             reads as a distinct "spotlight moment" instead of one more green
             card in the same wash. Warm amber glow (not another green one)
             keeps it from feeling monochrome, and gives the poster somewhere
             warm to sit against. ─────────────────────────────────────────── */}
      <div className="pointer-events-none absolute -right-24 -top-28 h-96 w-96 rounded-full bg-amber-400/20 blur-[100px]" />
      <div className="pointer-events-none absolute -bottom-32 -left-20 h-80 w-80 rounded-full bg-emerald-400/25 blur-[100px]" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-60 [background-image:radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.07)_1px,transparent_0)] [background-size:26px_26px] [mask-image:radial-gradient(ellipse_65%_65%_at_50%_0%,black,transparent)]"
      />
      <InspirationBackdrop />

      {/* ── Section introduction ─────────────────────────────────────────── */}
      <div className="relative z-10 flex flex-col items-center gap-4 text-center">
        <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 ring-1 ring-white/20 backdrop-blur-sm">
          <Sparkles className="h-3.5 w-3.5 text-amber-300" />
          <span className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-amber-200">
            Today&apos;s Inspiration
          </span>
        </div>

        <h2 className="max-w-xl text-2xl font-semibold leading-snug tracking-tight text-white sm:text-3xl">
          Real people. Real discipline. Real transformation.
        </h2>

        <p className="max-w-lg text-sm leading-relaxed text-emerald-50/95 sm:text-[0.95rem]">
          Every healthy meal is another step toward becoming the next success
          story.
        </p>
      </div>

      {/* ── Featured story: the testimonial poster, framed and floating ──── */}
      <div
        className="group relative z-10 mx-auto mt-11 w-full max-w-2xl focus:outline-none sm:mt-12"
        role="group"
        aria-roledescription="carousel"
        aria-label="Real transformation stories"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* Theatrical spotlight glow — warm amber light falling on the
            poster from behind, the visual anchor that makes the frame read
            as lit rather than just placed on a dark card. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -inset-6 -z-10 rounded-[2.5rem] bg-gradient-to-br from-amber-300/30 via-white/10 to-emerald-300/20 blur-3xl transition-opacity duration-500 group-hover:opacity-100 sm:-inset-10"
        />

        {/* Floating "stamp" badge — tucked into the frame's top-left
            corner with a slight tilt, like a seal on a campaign poster.
            Never overlaps the photo or copy inside the creative. */}
        <div className="absolute -left-3 -top-4 z-20 -rotate-3 inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[0.7rem] font-semibold text-emerald-700 shadow-[0_8px_20px_-4px_rgba(0,0,0,0.35)] ring-1 ring-emerald-900/10">
          <BadgeCheck className="h-3.5 w-3.5 text-emerald-600" />
          Verified Transformation
        </div>

        {/* Premium frame — thin foil-gradient edge, rounded corners, image
            floats inside on its own light mat. The warm gold-to-mint edge is
            what makes the poster "glow" against the dark backdrop. Lifts
            gently on hover. */}
        <div className="rounded-[1.9rem] bg-gradient-to-br from-amber-200/80 via-white to-emerald-200/80 p-[1.5px] shadow-[0_35px_80px_-25px_rgba(0,0,0,0.5)] transition-transform duration-300 ease-out group-hover:-translate-y-1 motion-reduce:transition-none motion-reduce:transform-none">
          <div className="rounded-[1.85rem] bg-white p-2.5 sm:p-3">
            <div className="relative aspect-[16/9] w-full overflow-hidden rounded-[1.5rem] bg-emerald-50/60">
              {STORY_IMAGES.map((src, i) => (
                <Image
                  key={src}
                  src={src}
                  alt={
                    i === index
                      ? `Real ArogyaDiet transformation story, ${i + 1} of ${STORY_IMAGES.length}`
                      : ""
                  }
                  aria-hidden={i !== index}
                  fill
                  sizes="(max-width: 768px) 100vw, 700px"
                  priority={i === 0}
                  loading={i === 0 ? undefined : "lazy"}
                  className={cn(
                    "object-contain transition-all duration-1000 ease-in-out motion-reduce:transition-none",
                    i === index
                      ? "scale-100 opacity-100"
                      : "scale-[0.98] opacity-0",
                  )}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Prev/next controls — desktop hover affordance, always keyboard/tap
            accessible. */}
        <button
          type="button"
          onClick={() => goTo(index - 1)}
          aria-label="Previous story"
          className="absolute left-1 top-1/2 z-20 -translate-y-1/2 rounded-full bg-white p-2 text-emerald-700 opacity-0 shadow-lg ring-1 ring-black/5 transition-opacity duration-200 hover:bg-emerald-50 focus-visible:opacity-100 group-hover:opacity-100 sm:-left-3"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => goTo(index + 1)}
          aria-label="Next story"
          className="absolute right-1 top-1/2 z-20 -translate-y-1/2 rounded-full bg-white p-2 text-emerald-700 opacity-0 shadow-lg ring-1 ring-black/5 transition-opacity duration-200 hover:bg-emerald-50 focus-visible:opacity-100 group-hover:opacity-100 sm:-right-3"
        >
          <ChevronRight className="h-4 w-4" />
        </button>

        {/* Premium pill indicators. Three distinct states, tuned for
            contrast against the dark backdrop (Instagram-story convention):
            upcoming = translucent white track, active = bright amber-gold
            animated fill (only this one carries the `story-progress-fill`
            animation class — applying it to every pill was the earlier bug,
            since a 0s default duration + forwards fill-mode made every pill
            snap to 100% width instantly), completed = solid white so
            "done" and "in progress" are unmistakably different at a
            glance. */}
        <div
          className="mt-7 flex items-center justify-center gap-2.5"
          role="tablist"
          aria-label="Choose a story"
        >
          {STORY_IMAGES.map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Go to story ${i + 1} of ${STORY_IMAGES.length}`}
              onClick={() => goTo(i)}
              className={cn(
                "h-2 overflow-hidden rounded-full bg-white/15 ring-1 ring-white/10 transition-all duration-300 sm:h-2.5",
                i === index ? "w-14 sm:w-16" : "w-2.5 sm:w-3",
              )}
            >
              {i === index ? (
                <span
                  key={`active-${index}`}
                  className="story-progress-fill block h-full w-full rounded-full bg-gradient-to-r from-amber-300 to-amber-500 shadow-[0_0_8px_rgba(252,211,77,0.6)]"
                  style={{
                    animationDuration: `${INTERVAL_MS}ms`,
                    animationPlayState: paused ? "paused" : "running",
                  }}
                />
              ) : i < index ? (
                <span className="block h-full w-full rounded-full bg-white" />
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {/* ── Bottom information bar ───────────────────────────────────────── */}
      <div className="relative z-10 mt-8 flex flex-col items-start gap-4 border-t border-white/15 pt-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2.5">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
          <div>
            <p className="text-sm font-semibold text-white">
              Real Transformation
            </p>
            <p className="mt-0.5 text-sm leading-relaxed text-emerald-100/70">
              Real people. Real commitment. Healthy habits changed their
              lives.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="group inline-flex w-full shrink-0 items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-emerald-900 shadow-lg transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:bg-amber-50 active:translate-y-0 active:scale-[0.98] sm:w-fit"
        >
          <Play className="h-4 w-4 fill-current" />
          Watch Journey
        </button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton
          className="max-w-3xl overflow-hidden p-0 sm:max-w-3xl"
        >
          <DialogTitle className="sr-only">
            A real ArogyaDiet transformation story
          </DialogTitle>
          <div className="aspect-video w-full bg-black">
            {open ? (
              <iframe
                src={embedSrc}
                title="ArogyaDiet transformation story"
                className="h-full w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/**
 * InspirationBackdrop — faint leaf/sprig line art, felt more than seen
 * (same Apple-wallpaper-low vocabulary as MealsHero's botanical backdrop).
 * Purely decorative → aria-hidden, never competes with the testimonial.
 */
function InspirationBackdrop() {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full text-white/[0.06]"
      viewBox="0 0 400 220"
      preserveAspectRatio="xMidYMid slice"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.2}
      strokeLinecap="round"
    >
      <path d="M-10 20 C 40 0, 90 40, 140 15" />
      <path d="M45 15c-6-6-14-4-18 2 8 3 15 1 18-2Z" fill="currentColor" stroke="none" />
      <path d="M85 27c7-5 8-13 3-19-6 6-6 14-3 19Z" fill="currentColor" stroke="none" />
      <path d="M390 200 C 350 210, 320 190, 330 165" />
      <path d="M345 178c9-3 14-11 12-19-8 3-13 11-12 19Z" fill="currentColor" stroke="none" />
      <path d="M357 190c-9-3-14-11-12-19 8 3 13 11 12 19Z" fill="currentColor" stroke="none" />
    </svg>
  );
}
