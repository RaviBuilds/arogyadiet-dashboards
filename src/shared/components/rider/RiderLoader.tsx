"use client";

/**
 * RiderLoader — Premium, reusable loading experience for the Rider Dashboard.
 *
 * Used as the loading UI for any screen inside the Rider portal
 * (deliverypartner.arogyadiet.com) — dashboard, route, payout, profile, etc.
 * Not tied to any single page's meaning: the visual is a neutral
 * "live GPS signal" pulse, which reads naturally as "the app is working"
 * regardless of which screen is loading.
 *
 * Usage:
 *   export default function Loading() {
 *     return <RiderLoader />;
 *   }
 *
 *   // or with a custom label for a specific screen
 *   <RiderLoader label="Loading payouts" />
 *
 * Performance:
 * - Pure CSS animations (GPU-accelerated via transform & opacity only)
 * - No animation libraries, no JS animation loop, no re-renders
 * - Minimal DOM nodes, fixed dimensions (zero layout shift / CLS)
 * - Colors sourced exclusively from the existing design system
 *   (--primary, --secondary, --accent)
 */

interface RiderLoaderProps {
  /** Optional label shown under the animation. Defaults to a neutral message. */
  label?: string;
}

export function RiderLoader({ label = "Just a moment" }: RiderLoaderProps) {
  return (
    <div className="rider-loader" role="status" aria-label={label}>
      <div className="rider-loader__canvas">
        {/* Animated GPS / location signal */}
        <svg
          viewBox="0 0 100 100"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="rider-loader__svg"
          aria-hidden="true"
        >
          {/* Outer pulse rings — signal propagating outward */}
          <circle
            cx="50"
            cy="50"
            r="14"
            stroke="var(--primary)"
            strokeWidth="2"
            className="rider-loader__ring rider-loader__ring--1"
          />
          <circle
            cx="50"
            cy="50"
            r="14"
            stroke="var(--secondary)"
            strokeWidth="2"
            className="rider-loader__ring rider-loader__ring--2"
          />

          {/* Center pin core */}
          <circle cx="50" cy="50" r="9" fill="var(--primary)" />
          <circle cx="50" cy="50" r="4" fill="var(--primary-foreground)" opacity="0.9" />
        </svg>

        {/* Label */}
        <p className="rider-loader__text">{label}</p>
      </div>

      {/* Scoped styles — zero global pollution */}
      <style jsx>{`
        .rider-loader {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 60vh;
          width: 100%;
          animation: riderLoaderFadeIn 0.4s ease-out both;
        }

        .rider-loader__canvas {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1.25rem;
        }

        .rider-loader__svg {
          width: 84px;
          height: 84px;
          overflow: visible;
        }

        .rider-loader__ring {
          transform-origin: 50px 50px;
          opacity: 0;
        }

        .rider-loader__ring--1 {
          animation: riderPulseRing 2s cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }

        .rider-loader__ring--2 {
          animation: riderPulseRing 2s cubic-bezier(0.4, 0, 0.2, 1) infinite;
          animation-delay: 1s;
        }

        .rider-loader__text {
          font-size: 0.875rem;
          font-weight: 600;
          color: var(--muted-foreground, #71717a);
          letter-spacing: 0.01em;
          animation: riderTextPulse 2s ease-in-out infinite;
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

        @keyframes riderPulseRing {
          0% {
            opacity: 0.6;
            transform: scale(0.6);
          }
          70% {
            opacity: 0;
            transform: scale(1.8);
          }
          100% {
            opacity: 0;
            transform: scale(1.8);
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
          .rider-loader__ring--1,
          .rider-loader__ring--2,
          .rider-loader__text {
            animation: none;
          }
          .rider-loader__ring--1,
          .rider-loader__ring--2 {
            opacity: 0.25;
          }
        }
      `}</style>
    </div>
  );
}
