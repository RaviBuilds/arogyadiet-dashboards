/**
 * Server-side performance timing utility.
 *
 * Enabled when NEXT_PUBLIC_PERF_TIMING=1 is set in .env.local.
 * Logs structured timing data to the server console (visible in terminal
 * during `npm run dev` or in Vercel function logs in production).
 *
 * Usage:
 *   const timer = createServerTimer("middleware");
 *   timer.mark("auth.getUser start");
 *   await supabase.auth.getUser();
 *   timer.mark("auth.getUser end");
 *   timer.done(); // logs the full waterfall
 */

const ENABLED = process.env.NEXT_PUBLIC_PERF_TIMING === "1";

export type ServerTimer = {
  mark: (label: string) => void;
  measure: <T>(label: string, fn: () => Promise<T>) => Promise<T>;
  done: () => void;
  elapsed: () => number;
};

export function createServerTimer(context: string): ServerTimer {
  if (!ENABLED) {
    // No-op when disabled — zero overhead
    const noop: ServerTimer = {
      mark: () => {},
      measure: <T>(_: string, fn: () => Promise<T>) => fn(),
      done: () => {},
      elapsed: () => 0,
    };
    return noop;
  }

  const start = performance.now();
  const marks: { label: string; time: number }[] = [];

  return {
    mark(label: string) {
      marks.push({ label, time: performance.now() - start });
    },

    async measure<T>(label: string, fn: () => Promise<T>): Promise<T> {
      const fnStart = performance.now();
      marks.push({ label: `${label} →start`, time: fnStart - start });
      const result = await fn();
      const fnEnd = performance.now();
      marks.push({ label: `${label} →end (${(fnEnd - fnStart).toFixed(1)}ms)`, time: fnEnd - start });
      return result;
    },

    done() {
      const total = performance.now() - start;
      const lines = marks.map(
        (m) => `  [${m.time.toFixed(1)}ms] ${m.label}`
      );
      console.log(
        `\n⏱ [PERF] ${context} — ${total.toFixed(1)}ms total\n${lines.join("\n")}\n`
      );
    },

    elapsed() {
      return performance.now() - start;
    },
  };
}
