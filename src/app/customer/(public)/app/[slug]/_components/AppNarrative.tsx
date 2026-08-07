// src/app/customer/(public)/app/[slug]/_components/AppNarrative.tsx
// Supporting copy for the download page: the app description and the feature
// list. Sits below the download card on mobile and below the headline on desktop.
//
// Features render as glass rows rather than bare list items: on a phone the
// contained rows give the list a rhythm and stop it reading as an undifferentiated
// wall of text, which is the failure mode of a five-item feature list on a narrow
// viewport.
//
// Requirements: 9.2, 9.10

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

import { APP_CONTENT } from "@/lib/appDistribution/content";
import type { AppSlug } from "@/lib/appDistribution/slug";
import type { AppTheme } from "./theme";

/**
 * Maps icon names from `content.ts` to Lucide components, keeping the content
 * module free of JSX and therefore trivially serialisable.
 *
 * `CheckCircle` is aliased to `CheckCircle2` because that is the name the rider
 * content uses and Lucide renamed the export.
 */
const ICON_MAP: Record<string, LucideIcon> = {
  Calendar,
  Pause,
  MapPin,
  Truck,
  Receipt,
  Route,
  Map,
  CheckCircle: CheckCircle2,
  CheckCircle2,
  Wallet,
};

interface AppNarrativeProps {
  slug: AppSlug;
  theme: AppTheme;
  className?: string;
}

export function AppNarrative({
  slug,
  theme,
  className,
}: AppNarrativeProps): React.ReactElement {
  const content = APP_CONTENT[slug];

  return (
    <div className={`flex flex-col gap-5 ${className ?? ""}`}>
      <p
        className={`text-center text-sm leading-relaxed sm:text-base lg:text-left ${theme.bodyText}`}
      >
        {content.description}
      </p>

      <ul className="flex flex-col gap-2.5" aria-label={`${content.title} features`}>
        {content.features.map((feature) => {
          const Icon = ICON_MAP[feature.icon] ?? Calendar;
          return (
            <li
              key={feature.title}
              className="flex items-start gap-3 rounded-xl bg-white/[0.07] p-3 ring-1 ring-white/10 backdrop-blur-sm sm:p-3.5 lg:bg-transparent lg:p-0 lg:ring-0 lg:backdrop-blur-none"
            >
              <span
                className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/15 sm:size-9 sm:rounded-xl"
                aria-hidden="true"
              >
                <Icon className={`h-4 w-4 ${theme.accentText}`} />
              </span>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-white">{feature.title}</h2>
                <p className={`mt-0.5 text-xs leading-relaxed sm:text-sm ${theme.mutedText}`}>
                  {feature.copy}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
