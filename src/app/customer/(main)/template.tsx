/**
 * Customer group template — applies a calm, consistent page transition to
 * every customer page. Unlike a layout, a template re-mounts on each
 * navigation, so wrapping children in `.reveal-page` gives a gentle fade +
 * tiny lift (~280ms) whenever the user moves between Dashboard, Profile,
 * Orders, Meals, Billing, etc. This is the reusable transition language for
 * the whole authenticated app.
 *
 * Presentation only — it renders children unchanged, just wrapped for motion.
 */
export default function CustomerTemplate({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="reveal-page">{children}</div>;
}
