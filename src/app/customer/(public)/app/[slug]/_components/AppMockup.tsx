// src/app/customer/(public)/app/[slug]/_components/AppMockup.tsx
// The device mockup shown between the headline and the download card on mobile,
// and in the right-hand column on desktop.
//
// The source PNGs under `public/app-screenshots/` are pre-rendered 3D device
// mockups on a transparent background — the phone bezel, notch and shadow are
// already baked into the artwork. So this component renders the image bare:
// wrapping it in the CSS phone frame the earlier placeholder needed would produce
// a phone inside a phone.
//
// Sizing is width-driven and capped on small viewports. At the artwork's 1857x3096
// ratio a full-width mockup on a phone would stand roughly 640px tall and push the
// download button off screen, so the mobile width is deliberately held to a
// fraction of the viewport.
//
// Requirements: 9.1, 9.10

import Image from "next/image";

import { APP_CONTENT } from "@/lib/appDistribution/content";
import type { AppSlug } from "@/lib/appDistribution/slug";
import type { AppTheme } from "./theme";

/** Intrinsic dimensions of the source artwork, used to reserve the aspect ratio. */
const ARTWORK_WIDTH = 1857;
const ARTWORK_HEIGHT = 3096;

interface AppMockupProps {
  slug: AppSlug;
  theme: AppTheme;
  className?: string;
}

export function AppMockup({
  slug,
  theme,
  className,
}: AppMockupProps): React.ReactElement {
  const { screenshot } = APP_CONTENT[slug];

  return (
    <div className={`flex justify-center ${className ?? ""}`}>
      <div className="relative w-[min(64vw,15rem)] sm:w-[min(52vw,17rem)] lg:w-full lg:max-w-[24rem]">
        {/* Halo behind the artwork so its transparent edges have something to
            separate from on the gradient. Decorative. */}
        <div
          className={`pointer-events-none absolute left-1/2 top-1/2 h-[80%] w-[130%] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl ${theme.mockupHalo}`}
          aria-hidden="true"
        />

        <Image
          src={screenshot.src}
          alt={screenshot.alt}
          width={ARTWORK_WIDTH}
          height={ARTWORK_HEIGHT}
          priority
          sizes="(max-width: 640px) 64vw, (max-width: 1024px) 52vw, 24rem"
          className="relative h-auto w-full select-none drop-shadow-[0_20px_45px_rgba(0,0,0,0.45)]"
        />
      </div>
    </div>
  );
}
