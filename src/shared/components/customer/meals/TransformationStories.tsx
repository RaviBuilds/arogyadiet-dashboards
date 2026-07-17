"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Play, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * TransformationStories — "Today's Inspiration".
 *
 * Craftsmanship pass: the testimonial photos themselves already carry a
 * title, branding, and stats baked into the image (they're produced as
 * finished video-thumbnail graphics, not plain portraits) — so an earlier
 * version of this section that overlaid a large quote on top of them
 * created three competing text layers fighting for attention. This version
 * respects the media instead: each slide is treated as a premium media
 * card — large image, soft bottom gradient (just enough to anchor a small
 * category label), and one CTA. No text is layered over the photo content.
 *
 * Auto-rotates through all 5 images with a crossfade (same mechanic as the
 * Dashboard's RotatingFoodImage), and pauses on: hidden tab, card scrolled
 * off-screen, and hover/focus — since this is a hero-weight section a
 * customer may want to pause on. Only the first image is eager; the rest
 * are lazy-loaded.
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // Auto-advance — paused when the tab is hidden, the card is off-screen, or
  // the customer is hovering/focused on it. Skipped for reduced-motion.
  useEffect(() => {
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) return;

    const stop = () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
    const start = () => {
      if (timerRef.current) return;
      timerRef.current = setInterval(() => {
        setIndex((i) => (i + 1) % STORY_IMAGES.length);
      }, INTERVAL_MS);
    };

    if (isVisible && !isHovered && !document.hidden) start();
    else stop();

    const handleVisibility = () => {
      if (document.hidden || !isVisible || isHovered) stop();
      else start();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [isVisible, isHovered]);

  const embedSrc = `https://www.youtube.com/embed/${youtubeId}?start=${youtubeStart}&autoplay=1&rel=0&modestbranding=1`;

  return (
    <section
      ref={containerRef}
      className="reveal-rise overflow-hidden rounded-3xl border border-primary/10 bg-white shadow-sm"
      style={{ ["--reveal-delay" as string]: "900ms" }}
      aria-roledescription="carousel"
      aria-label="Real transformation stories"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={() => setIsHovered(true)}
      onBlur={() => setIsHovered(false)}
    >
      <div className="flex items-center gap-2 px-6 pt-6 sm:px-7">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="text-xs font-semibold uppercase tracking-wider text-primary">
          Today&apos;s Inspiration
        </span>
      </div>

      {/* Premium media card — the photo IS the story. No text overlay. */}
      <div className="relative mt-4 aspect-[4/3] w-full overflow-hidden sm:aspect-[16/9]">
        {STORY_IMAGES.map((src, i) => (
          <Image
            key={src}
            src={src}
            alt={i === index ? "A real ArogyaDiet transformation story" : ""}
            aria-hidden={i !== index}
            fill
            sizes="(max-width: 768px) 100vw, 700px"
            priority={i === 0}
            loading={i === 0 ? undefined : "lazy"}
            className={cn(
              "object-cover transition-opacity duration-1000 ease-in-out motion-reduce:transition-none",
              i === index ? "opacity-100" : "opacity-0",
            )}
          />
        ))}
        {/* Just enough gradient to anchor the small label — never fights the photo. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/40 to-transparent" />

        <span className="absolute left-4 bottom-4 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary shadow-sm backdrop-blur-sm">
          Real Transformation
        </span>

        {/* Slide indicator dots. */}
        <div className="absolute right-4 top-4 flex gap-1.5">
          {STORY_IMAGES.map((_, i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 w-1.5 rounded-full bg-white/50 transition-all duration-300",
                i === index && "w-4 bg-white",
              )}
              aria-hidden="true"
            />
          ))}
        </div>
      </div>

      <div className="flex flex-col items-start gap-3 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-7">
        <p className="text-sm leading-relaxed text-slate-500">
          Real people. Small consistent choices. Lasting transformations.
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="group inline-flex w-fit shrink-0 items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-200 hover:shadow-md hover:brightness-105 active:scale-[0.98]"
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
