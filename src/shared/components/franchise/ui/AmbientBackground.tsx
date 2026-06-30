/**
 * Ambient background layer for a premium glassmorphic environment.
 * Renders a soft mesh gradient combined with a faint dot pattern.
 * Fixed and pointer-events-none so it sits behind all content.
 */
export function AmbientBackground() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      {/* Base wash */}
      <div className="absolute inset-0 bg-gradient-to-b from-slate-50 via-white to-slate-50" />

      {/* Soft mesh gradient blobs */}
      <div className="absolute -top-40 -left-32 h-[28rem] w-[28rem] rounded-full bg-primary/10 blur-[120px]" />
      <div className="absolute -top-24 right-0 h-[24rem] w-[24rem] rounded-full bg-secondary/10 blur-[120px]" />
      <div className="absolute bottom-0 left-1/3 h-[22rem] w-[22rem] rounded-full bg-sky-200/20 blur-[120px]" />

      {/* Faint dot pattern */}
      <div
        className="absolute inset-0 opacity-[0.4]"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgb(15 23 42 / 0.04) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        }}
      />
    </div>
  );
}
