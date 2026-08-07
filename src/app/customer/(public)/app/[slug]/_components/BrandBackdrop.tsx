// src/app/customer/(public)/app/[slug]/_components/BrandBackdrop.tsx
// Ambient glow wells + botanical line art for the download pages.
//
// Purely decorative and entirely `aria-hidden`, so it adds nothing to the
// accessibility tree and nothing to the client bundle. The line-art paths are
// the same botanical vocabulary used on the customer login brand panel — the
// point of this page is to read as the same brand, and the texture is a large
// part of why that panel does.

import type { AppTheme } from "./theme";

interface BrandBackdropProps {
  theme: AppTheme;
}

export function BrandBackdrop({ theme }: BrandBackdropProps): React.ReactElement {
  const [glowA, glowB, glowC] = theme.glows;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {/* Glow wells — these carry the depth. */}
      <div
        className={`absolute -left-32 -top-32 h-[26rem] w-[26rem] rounded-full blur-3xl ${glowA}`}
      />
      <div
        className={`absolute bottom-0 right-0 h-[30rem] w-[30rem] translate-x-1/4 translate-y-1/4 rounded-full blur-3xl ${glowB}`}
      />
      <div
        className={`absolute left-1/3 top-1/2 h-80 w-80 -translate-x-1/2 rounded-full blur-3xl ${glowC}`}
      />

      {/* Botanical line art, bleeding off the edges like texture. */}
      <svg
        className={`absolute inset-0 h-full w-full ${theme.lineArt}`}
        viewBox="0 0 400 600"
        preserveAspectRatio="xMidYMid slice"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.2}
        strokeLinecap="round"
      >
        {/* trailing vine, upper area */}
        <path d="M-10 90 C 60 60, 110 120, 170 80" />
        <path d="M50 78c-7-7-17-5-22 2 9 4 18 1 22-2Z" fill="currentColor" stroke="none" />
        <path d="M100 100c8-6 9-16 3-23-7 7-7 16-3 23Z" fill="currentColor" stroke="none" />
        <path d="M140 84c-7-7-17-6-22 1 9 5 18 2 22-1Z" fill="currentColor" stroke="none" />

        {/* wheat stalk, mid-panel */}
        <path d="M320 420 C 314 360, 314 310, 320 270" />
        <path d="M320 310c10-5 15-14 12-23-9 4-14 14-12 23Z" fill="currentColor" stroke="none" />
        <path d="M320 328c-10-5-15-14-12-23 9 4 14 14 12 23Z" fill="currentColor" stroke="none" />
        <path d="M320 346c10-5 15-14 12-23-9 4-14 14-12 23Z" fill="currentColor" stroke="none" />
        <path d="M320 364c-10-5-15-14-12-23 9 4 14 14 12 23Z" fill="currentColor" stroke="none" />

        {/* large calm leaf, bleeding off the bottom-right edge */}
        <path d="M260 560 C 300 480, 380 460, 430 490" />
        <path d="M330 470c18-13 23-36 10-52-17 15-18 39-10 52Z" fill="currentColor" stroke="none" />

        {/* single sprig, upper-right */}
        <path d="M360 60c4 18-4 32-18 40" />
        <path d="M348 78c9-2 15-10 13-19-8 3-14 11-13 19Z" fill="currentColor" stroke="none" />
      </svg>
    </div>
  );
}
