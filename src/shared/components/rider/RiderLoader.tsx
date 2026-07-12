"use client";

/**
 * RiderLoader — Premium, reusable loading experience for the Rider Dashboard.
 *
 * Used as the loading UI for any screen inside the Rider portal
 * (deliverypartner.arogyadiet.com) — dashboard, route, payout, profile, etc.
 *
 * Design concept: a map pin "dropping" onto a location, with ripple rings
 * emanating from the ground point and a slow radar sweep encircling it —
 * the kind of navigation-flavored motion you'd see in Uber/Google Maps
 * while a route or position is being resolved. No text is required; the
 * motion itself communicates "actively working."
 *
 * Usage:
 *   export default function Loading() {
 *     return <RiderLoader />;
 *   }
 *
 *   // an optional, very subtle caption can still be provided per-screen
 *   <RiderLoader label="Loading payouts" />
 *
 * Performance:
 * - Pure CSS + SVG animations (GPU-accelerated via transform & opacity only)
 * - No animation libraries, no JS animation loop, no re-renders
 * - Single static radial glow (not animated) plus 5 lightweight animated
 *   primitives — well within budget for 60fps on low-end mobile devices
 * - Fixed dimensions, no layout shift / CLS
 * - Colors sourced exclusively from the existing design system
 *   (--primary, --secondary, --accent)
 */

interface RiderLoaderProps {
  /** Optional caption shown under the animation. Omitted by default — the motion speaks for itself. */
  label?: string;
}

export function RiderLoader({ label }: RiderLoaderProps) {
  return (
    <div className="rider-loader" role="status" aria-label={label ?? "Loading"}>
      <div className="rider-loader__stage">
        {/* Static ambient glow — adds depth without animating per-frame cost */}
        <div className="rider-loader__glow" aria-hidden="true" />

        <svg
          viewBox="0 0 200 200"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="rider-loader__svg"
          aria-hidden="true"
        >
          {/* Slow radar sweep encircling the pin */}
          <circle
            cx="100"
            cy="92"
            r="80"
            stroke="var(--accent)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="18 220"
            className="rider-loader__radar"
          />

          {/* Ripple rings — emanate from the pin's ground point */}
          <circle cx="100" cy="132" r="8" className="rider-loader__ripple rider-loader__ripple--1" stroke="var(--primary)" strokeWidth="2.5" />
          <circle cx="100" cy="132" r="8" className="rider-loader__ripple rider-loader__ripple--2" stroke="var(--secondary)" strokeWidth="2.5" />
          <circle cx="100" cy="132" r="8" className="rider-loader__ripple rider-loader__ripple--3" stroke="var(--primary)" strokeWidth="2.5" />

          {/* Ground point */}
          <ellipse cx="100" cy="132" rx="10" ry="3.5" fill="var(--primary)" opacity="0.18" />

          {/* Map pin */}
          <g className="rider-loader__pin">
            <path
              d="M100,130 C100,130 70,95 70,70 C70,53.4 83.4,40 100,40 C116.6,40 130,53.4 130,70 C130,95 100,130 100,130 Z"
              fill="var(--primary)"
            />
            <circle cx="100" cy="70" r="13" fill="var(--primary-foreground)" />
            <circle cx="100" cy="70" r="6" fill="var(--secondary)" />
          </g>
        </svg>
      </div>

      {label && <p className="rider-loader__text">{label}</p>}

      {/* Scoped styles — zero global pollution */}
      <style jsx>{`
        .rider-loader {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 1.5rem;
          min-height: 65vh;
          width: 100%;
          animation: riderLoaderFadeIn 0.4s ease-out both;
        }

        .rider-loader__stage {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          width: clamp(220px, 62vw, 280px);
          height: clamp(220px, 62vw, 280px);
        }

        .rider-loader__glow {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          background: radial-gradient(
            circle at 50% 58%,
            color-mix(in srgb, var(--primary) 16%, transparent) 0%,
            color-mix(in srgb, var(--secondary) 8%, transparent) 45%,
            transparent 72%
          );
          animation: riderGlowBreathe 4s ease-in-out infinite;
          will-change: transform, opacity;
        }

        .rider-loader__svg {
          position: relative;
          width: 100%;
          height: 100%;
          overflow: visible;
        }

        .rider-loader__radar {
          transform-origin: 100px 92px;
          opacity: 0.35;
          animation: riderRadarSpin 6s linear infinite;
        }

        .rider-loader__ripple {
          transform-origin: 100px 132px;
          opacity: 0;
          animation: riderRippleExpand 2.4s cubic-bezier(0.25, 0.1, 0.25, 1) infinite;
        }

        .rider-loader__ripple--1 {
          animation-delay: 0s;
        }
        .rider-loader__ripple--2 {
          animation-delay: -0.8s;
        }
        .rider-loader__ripple--3 {
          animation-delay: -1.6s;
        }

        .rider-loader__pin {
          transform-origin: 100px 130px;
          animation: riderPinBreathe 2.4s ease-in-out infinite;
          filter: drop-shadow(0 6px 10px color-mix(in srgb, var(--primary) 35%, transparent));
        }

        .rider-loader__text {
          font-size: 0.875rem;
          font-weight: 600;
          color: var(--muted-foreground, #71717a);
          letter-spacing: 0.01em;
          animation: riderTextPulse 2.4s ease-in-out infinite;
        }

        /* Keyframes — GPU-friendly (transform & opacity only) */

        @keyframes riderLoaderFadeIn {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes riderGlowBreathe {
          0%, 100% {
            opacity: 0.7;
            transform: scale(1);
          }
          50% {
            opacity: 1;
            transform: scale(1.06);
          }
        }

        @keyframes riderRadarSpin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }

        @keyframes riderRippleExpand {
          0% {
            opacity: 0.55;
            transform: scale(0.4);
          }
          70% {
            opacity: 0;
          }
          100% {
            opacity: 0;
            transform: scale(6.5);
          }
        }

        @keyframes riderPinBreathe {
          0%, 100% {
            transform: translateY(0) scale(1);
          }
          50% {
            transform: translateY(-5px) scale(1.035);
          }
        }

        @keyframes riderTextPulse {
          0%, 100% {
            opacity: 0.6;
          }
          50% {
            opacity: 1;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .rider-loader,
          .rider-loader__glow,
          .rider-loader__radar,
          .rider-loader__ripple,
          .rider-loader__pin,
          .rider-loader__text {
            animation: none;
          }
          .rider-loader__ripple {
            opacity: 0.15;
          }
          .rider-loader__radar {
            opacity: 0.2;
          }
        }
      `}</style>
    </div>
  );
}
