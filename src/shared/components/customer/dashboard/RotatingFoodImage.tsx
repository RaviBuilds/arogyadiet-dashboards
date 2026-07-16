"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * RotatingFoodImage — a lightweight, Spotify-album-art-style crossfade between
 * a small set of meal photos. Only one image is visible at a time; images are
 * stacked and cross-faded via opacity so there is never a layout shift.
 *
 * - Auto-advances every `intervalMs` (default ~5.5s).
 * - Pauses while the browser tab is hidden (saves work, resumes on return).
 * - Preloads all images (they are all mounted; the first is prioritised).
 * - Gracefully renders a single static image when only one is provided.
 */
export function RotatingFoodImage({
  images,
  alt,
  intervalMs = 5500,
  sizes = "(max-width: 640px) 100vw, 40vw",
}: {
  images: string[];
  alt: string;
  intervalMs?: number;
  sizes?: string;
}) {
  const [index, setIndex] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (images.length <= 1) return;

    const stop = () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
    const start = () => {
      if (timerRef.current) return;
      timerRef.current = setInterval(() => {
        setIndex((i) => (i + 1) % images.length);
      }, intervalMs);
    };
    const handleVisibility = () => {
      if (document.hidden) stop();
      else start();
    };

    start();
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [images.length, intervalMs]);

  return (
    <>
      {images.map((src, i) => (
        <Image
          key={src}
          src={src}
          alt={i === 0 ? alt : ""}
          aria-hidden={i !== index}
          fill
          sizes={sizes}
          priority={i === 0}
          className={cn(
            "object-cover transition-opacity duration-1000 ease-in-out motion-reduce:transition-none",
            i === index ? "opacity-100" : "opacity-0",
          )}
        />
      ))}
    </>
  );
}
