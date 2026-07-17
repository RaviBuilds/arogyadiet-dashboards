/**
 * Customer group template — applies a calm, consistent page transition to
 * every customer page. Unlike a layout, a template re-mounts on each
 * navigation, so wrapping children in `.reveal-page` gives a gentle fade +
 * tiny lift (~280ms) whenever the user moves between Dashboard, Profile,
 * Orders, Meals, Billing, etc. This is the reusable transition language for
 * the whole authenticated app.
 *
 * Presentation only — it renders children unchanged, just wrapped for motion.
 *
 * It also hosts the single <AppReadyBeacon />. Because the template lives INSIDE
 * the layout's `<Suspense fallback={null}>` boundary (see (main)/layout.tsx) and
 * re-mounts on every navigation, React withholds this whole subtree — beacon
 * included — until the page's async content resolves. The beacon therefore
 * fires exactly when real content is present, for EVERY customer page and on
 * every navigation. GlobalLoader waits for it, so users only ever see
 * Loader → Content, never a skeleton or a blank frame.
 */
import { AppReadyBeacon } from "@/shared/components/loader/AppReadyBeacon";

export default function CustomerTemplate({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="reveal-page">
      {children}
      <AppReadyBeacon />
    </div>
  );
}
