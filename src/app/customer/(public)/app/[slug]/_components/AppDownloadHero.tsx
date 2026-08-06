// src/app/customer/(public)/app/[slug]/_components/AppDownloadHero.tsx
// Server Component that renders the hero section with phone frame mockup,
// tagline, description, and feature list for the app download page.
//
// Requirements: 9.1, 9.2, 9.10

import Image from "next/image";
import { APP_CONTENT } from "@/lib/appDistribution/content";
import type { AppSlug } from "@/lib/appDistribution/slug";
import {
  Calendar,
  Pause,
  MapPin,
  Truck,
  Receipt,
  Route,
  Map,
  CheckCircle2,
  Wallet,
  type LucideIcon,
} from "lucide-react";

/**
 * Map icon names from content.ts to Lucide icon components.
 * This allows content to remain serializable while supporting dynamic icons.
 */
const ICON_MAP: Record<string, LucideIcon> = {
  Calendar,
  Pause,
  MapPin,
  Truck,
  Receipt,
  Route,
  Map,
  CheckCircle2,
  Wallet,
};

interface AppDownloadHeroProps {
  /** The app slug to render content for */
  slug: AppSlug;
}

/**
 * AppDownloadHero is a Server Component that renders the hero section
 * of the download page, including:
 *
 * - A CSS phone frame mockup (rounded bordered container with notch pseudo-element)
 *   wrapping a next/image for the screenshot (Req 9.1)
 * - Tagline and description text (Req 9.2)
 * - Feature list with icons mapped from content.ts
 *
 * The phone frame is implemented purely with CSS:
 * - Rounded corners and border for the phone bezel
 * - A pseudo-element for the notch at the top
 * - Aspect ratio matching mobile proportions
 *
 * Screenshots are local files under public/app-screenshots/ (Req 9.1).
 * Alt text comes from content.ts (Req 9.10).
 *
 * @param props - Component props
 * @param props.slug - The app slug to render content for
 * @returns The hero section component
 */
export function AppDownloadHero({ slug }: AppDownloadHeroProps): React.ReactElement {
  const content = APP_CONTENT[slug];

  return (
    <div className="flex flex-col lg:flex-row gap-8 items-center lg:items-start">
      {/* Phone frame mockup */}
      <div
        className="relative flex-shrink-0"
        aria-label={`Screenshot of ${content.title}`}
      >
        {/* Phone bezel with notch */}
        <div
          className="
            relative
            w-[280px] h-[560px]
            rounded-[2.5rem]
            border-4
            border-slate-200
            dark:border-slate-700
            bg-slate-100
            dark:bg-slate-800
            shadow-xl
            overflow-hidden
          "
        >
          {/* Notch pseudo-element */}
          <div
            className="
              absolute
              top-0
              left-1/2
              -translate-x-1/2
              w-32
              h-7
              bg-slate-200
              dark:bg-slate-700
              rounded-b-2xl
              z-10
            "
            aria-hidden="true"
          />

          {/* Screen content - screenshot image */}
          <div className="absolute inset-2 top-4 rounded-[2rem] overflow-hidden bg-white dark:bg-slate-900">
            <Image
              src={content.screenshot.src}
              alt={content.screenshot.alt}
              fill
              className="object-cover object-top"
              sizes="(max-width: 768px) 280px, 280px"
              priority
            />
          </div>
        </div>
      </div>

      {/* Content section */}
      <div className="flex-1 min-w-0 text-center lg:text-left">
        {/* Tagline */}
        <p className="text-primary font-medium text-sm uppercase tracking-wide mb-2">
          {content.tagline}
        </p>

        {/* Description */}
        <p className="text-muted-foreground leading-relaxed mb-6">
          {content.description}
        </p>

        {/* Feature list */}
        <ul
          className="space-y-4"
          aria-label={`${content.title} features`}
        >
          {content.features.map((feature, index) => {
            const IconComponent = ICON_MAP[feature.icon];
            return (
              <li
                key={index}
                className="flex items-start gap-3"
              >
                <div
                  className="
                    flex-shrink-0
                    w-8 h-8
                    rounded-lg
                    bg-primary/10
                    text-primary
                    flex items-center justify-center
                  "
                  aria-hidden="true"
                >
                  {IconComponent ? (
                    <IconComponent className="h-4 w-4" />
                  ) : (
                    <Calendar className="h-4 w-4" />
                  )}
                </div>
                <div className="min-w-0">
                  <h3 className="font-medium text-sm">{feature.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {feature.copy}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
