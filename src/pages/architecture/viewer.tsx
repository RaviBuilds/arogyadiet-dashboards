/**
 * TEMPORARY architecture viewer (client). Isolation contract:
 * - Reads nothing itself; markdown arrives via getServerSideProps from
 *   architecture-analysis/ (READ-ONLY source of truth).
 * - Mermaid is loaded from the jsDelivr CDN at runtime — ZERO package.json changes.
 * - Hand-rolled Markdown renderer covering exactly the subset used by the docs
 *   (headings, lists, tables, fenced code, blockquotes, inline styles).
 * - Cleanup when done: delete pages/ + remove the /architecture middleware bypass.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";

export interface ArchDoc {
  slug: string;
  title: string;
  markdown: string;
}

/* ------------------------------------------------------------------ */
/* Mermaid (CDN)                                                       */
/* ------------------------------------------------------------------ */

type MermaidApi = {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, source: string) => Promise<{ svg: string }>;
};

declare global {
  interface Window {
    mermaid?: MermaidApi;
    __archvMermaidPromise?: Promise<MermaidApi | null>;
  }
}

function loadMermaid(): Promise<MermaidApi | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.mermaid) return Promise.resolve(window.mermaid);
  if (!window.__archvMermaidPromise) {
    window.__archvMermaidPromise = new Promise<MermaidApi | null>((resolve) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js";
      script.async = true;
      script.onload = () => {
        const api = window.mermaid;
        if (api) {
          api.initialize({
            startOnLoad: false,
            theme: "base",
            securityLevel: "loose",
          });
          resolve(api);
        } else {
          resolve(null);
        }
      };
      script.onerror = () => resolve(null);
      document.head.appendChild(script);
    });
  }
  return window.__archvMermaidPromise;
}

/* ------------------------------------------------------------------ */
/* Markdown parsing (subset used by architecture-analysis docs)        */
/* ------------------------------------------------------------------ */

type Block =
  | { kind: "h"; level: number; text: string }
  | { kind: "p"; text: string }
  | { kind: "hr" }
  | { kind: "quote"; text: string }
  | { kind: "ul"; items: { text: string; depth: number }[] }
  | { kind: "ol"; items: { text: string; depth: number }[] }
  | { kind: "table"; header: string[]; rows: string[][] }
  | { kind: "code"; lang: string; text: string }
  | { kind: "mermaid"; text: string };

export function parseMarkdown(md: string): Block[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const lang = (fence[1] || "").toLowerCase();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++;
      if (lang === "mermaid") blocks.push({ kind: "mermaid", text: buf.join("\n") });
      else blocks.push({ kind: "code", lang, text: buf.join("\n") });
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      blocks.push({ kind: "h", level: h[1].length, text: h[2].trim() });
      i++;
      continue;
    }

    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push({ kind: "hr" });
      i++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ kind: "quote", text: buf.join(" ") });
      continue;
    }

    if (
      /^\s*\|/.test(line) &&
      i + 1 < lines.length &&
      lines[i + 1].includes("-") &&
      /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1])
    ) {
      const splitRow = (row: string) =>
        row
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => c.trim());
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push({ kind: "table", header, rows });
      continue;
    }

    const li = line.match(/^(\s*)(?:[-*]|\d+\.)\s+(.*)$/);
    if (li) {
      const ordered = /^\s*\d+\./.test(line);
      const items: { text: string; depth: number }[] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)(?:[-*]|\d+\.)\s+(.*)$/);
        if (!m) break;
        items.push({ text: m[2].trim(), depth: Math.floor(m[1].length / 2) });
        i++;
      }
      blocks.push(ordered ? { kind: "ol", items } : { kind: "ul", items });
      continue;
    }

    if (line.trim() === "") {
      i++;
      continue;
    }

    const buf: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^```/.test(lines[i]) &&
      !/^#{1,6}\s/.test(lines[i]) &&
      !/^>/.test(lines[i]) &&
      !/^\s*\|/.test(lines[i]) &&
      !/^(\s*)(?:[-*]|\d+\.)\s+/.test(lines[i]) &&
      !/^\s*(-{3,})\s*$/.test(lines[i])
    ) {
      buf.push(lines[i].trim());
      i++;
    }
    if (buf.length > 0) blocks.push({ kind: "p", text: buf.join(" ") });
  }
  return blocks;
}

/* ------------------------------------------------------------------ */
/* Inline text rendering (code, bold, italic, links)                   */
/* ------------------------------------------------------------------ */

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern =
    /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const token = m[0];
    const key = `${keyPrefix}-i${k++}`;
    if (token.startsWith("`")) {
      nodes.push(
        <code key={key} className="archv-inline-code">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*")) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else {
      const lm = token.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      if (lm) {
        nodes.push(
          <a key={key} href={lm[2]} target="_blank" rel="noreferrer">
            {lm[1]}
          </a>,
        );
      } else {
        nodes.push(token);
      }
    }
    last = m.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/* ------------------------------------------------------------------ */
/* Diagram frame: zoom (ctrl+wheel / buttons) + pan (drag) + fullscreen */
/* ------------------------------------------------------------------ */

function DiagramFrame({
  id,
  text,
  failed,
}: {
  id: string;
  text: string;
  failed: boolean;
}) {
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });
  const [full, setFull] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ sx: number; sy: number; tx: number; ty: number } | null>(
    null,
  );

  const clampScale = (s: number) => Math.min(Math.max(s, 0.25), 4);

  const zoomAt = (cx: number, cy: number, factor: number) => {
    setView((v) => {
      const next = clampScale(v.scale * factor);
      if (next === v.scale) return v;
      return {
        scale: next,
        tx: cx - (cx - v.tx) * (next / v.scale),
        ty: cy - (cy - v.ty) * (next / v.scale),
      };
    });
  };

  const zoomCenter = (factor: number) => {
    const vp = viewportRef.current;
    zoomAt(vp ? vp.clientWidth / 2 : 0, vp ? vp.clientHeight / 2 : 0, factor);
  };

  // Ctrl/⌘ + wheel zooms at the cursor; plain wheel keeps scrolling the page.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const rect = vp.getBoundingClientRect();
      zoomAt(
        e.clientX - rect.left,
        e.clientY - rect.top,
        e.deltaY < 0 ? 1.15 : 1 / 1.15,
      );
    };
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => vp.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escape exits fullscreen
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFull(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    drag.current = { sx: e.clientX, sy: e.clientY, tx: view.tx, ty: view.ty };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    setView((v) => ({
      ...v,
      tx: d.tx + (e.clientX - d.sx),
      ty: d.ty + (e.clientY - d.sy),
    }));
  };
  const endDrag = () => {
    drag.current = null;
  };

  return (
    <div className={`archv-frame${full ? " archv-fullscreen" : ""}`}>
      <div className="archv-tb">
        <button type="button" title="Zoom in" onClick={() => zoomCenter(1.2)}>
          ＋
        </button>
        <button type="button" title="Zoom out" onClick={() => zoomCenter(1 / 1.2)}>
          −
        </button>
        <button
          type="button"
          title="Reset to 100%"
          onClick={() => setView({ scale: 1, tx: 0, ty: 0 })}
        >
          Reset
        </button>
        <span className="archv-zoom">{Math.round(view.scale * 100)}%</span>
        <span className="archv-tb-hint">Ctrl+wheel zoom · drag to pan</span>
        <button
          type="button"
          className="archv-tb-fs"
          title={full ? "Exit fullscreen" : "Fullscreen"}
          onClick={() => {
            setFull((f) => !f);
            setView({ scale: 1, tx: 0, ty: 0 });
          }}
        >
          {full ? "✕ Exit" : "⛶ Fullscreen"}
        </button>
      </div>
      <div
        className="archv-viewport"
        ref={viewportRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
      >
        <div
          className="archv-canvas"
          style={{
            transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
            transformOrigin: "0 0",
          }}
        >
          {failed ? (
            <pre>
              <code>{text}</code>
            </pre>
          ) : (
            <div
              id={id}
              className="archv-mermaid"
              aria-label="Mermaid diagram"
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Block rendering                                                     */
/* ------------------------------------------------------------------ */

function BlockView({
  block,
  docSlug,
  index,
  failed,
}: {
  block: Block;
  docSlug: string;
  index: number;
  failed: boolean;
}) {
  const key = `${docSlug}-b${index}`;
  switch (block.kind) {
    case "h": {
      const level = Math.min(Math.max(block.level, 1), 4);
      const Tag = (`h${level}` as unknown) as keyof React.JSX.IntrinsicElements;
      return <Tag>{renderInline(block.text, key)}</Tag>;
    }
    case "p":
      return <p>{renderInline(block.text, key)}</p>;
    case "hr":
      return <hr />;
    case "quote":
      return <blockquote>{renderInline(block.text, key)}</blockquote>;
    case "ul":
      return (
        <ul>
          {block.items.map((it, n) => (
            <li key={`${key}-${n}`} style={{ marginLeft: it.depth * 20 }}>
              {renderInline(it.text, `${key}-${n}`)}
            </li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol>
          {block.items.map((it, n) => (
            <li key={`${key}-${n}`} style={{ marginLeft: it.depth * 20 }}>
              {renderInline(it.text, `${key}-${n}`)}
            </li>
          ))}
        </ol>
      );
    case "table":
      return (
        <table>
          <thead>
            <tr>
              {block.header.map((c, n) => (
                <th key={`${key}-h${n}`}>{renderInline(c, `${key}-h${n}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, r) => (
              <tr key={`${key}-r${r}`}>
                {row.map((c, n) => (
                  <td key={`${key}-r${r}c${n}`}>
                    {renderInline(c, `${key}-r${r}c${n}`)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "code":
      return (
        <pre>
          <code>{block.text}</code>
        </pre>
      );
    case "mermaid":
      return (
        <DiagramFrame
          id={`archv-mm-${docSlug}-${index}`}
          text={block.text}
          failed={failed}
        />
      );
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* Viewer                                                              */
/* ------------------------------------------------------------------ */

export function ArchitectureViewer({
  docs,
  initialView,
}: {
  docs: ArchDoc[];
  initialView: string;
}) {
  const [active, setActive] = useState(initialView);
  const [failed, setFailed] = useState<Record<number, boolean>>({});
  const activeDoc = docs.find((d) => d.slug === active) ?? docs[0];
  const blocks = useMemo(
    () => parseMarkdown(activeDoc?.markdown ?? ""),
    [activeDoc],
  );
  const mermaidIndexes = useMemo(
    () =>
      blocks
        .map((b, idx) => (b.kind === "mermaid" ? { idx, b } : null))
        .filter(
          (x): x is { idx: number; b: Extract<Block, { kind: "mermaid" }> } =>
            x !== null,
        ),
    [blocks],
  );

  // Keep ?view= in sync + reset scroll on doc switch
  useEffect(() => {
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("view", active);
      window.history.replaceState(null, "", url.toString());
    }
    setFailed({});
    const el = document.getElementById("archv-content");
    if (el) el.scrollTop = 0;
  }, [active]);

  // Render mermaid diagrams client-side after CDN load
  useEffect(() => {
    if (mermaidIndexes.length === 0) return;
    let cancelled = false;
    (async () => {
      const api = await loadMermaid();
      if (!api || cancelled) return;
      for (const { idx, b } of mermaidIndexes) {
        if (cancelled) return;
        const el = document.getElementById(`archv-mm-${active}-${idx}`);
        if (!el) continue;
        try {
          const id = `archv-svg-${active}-${idx}-${Math.random()
            .toString(36)
            .slice(2)}`;
          const { svg } = await api.render(id, b.text);
          if (cancelled) return;
          el.innerHTML = svg;
        } catch {
          if (!cancelled) setFailed((prev) => ({ ...prev, [idx]: true }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, blocks, mermaidIndexes]);

  const activeTitle = activeDoc?.title ?? "";

  return (
    <div className="archv-root">
      <style>{ARCHV_STYLES}</style>
      <nav className="archv-sidebar">
        <div className="archv-brand">AROGYADIET</div>
        {docs.map((d) => (
          <button
            key={d.slug}
            type="button"
            className={`archv-navitem${d.slug === active ? " active" : ""}`}
            onClick={() => setActive(d.slug)}
          >
            {d.title}
          </button>
        ))}
        <div className="archv-note">
          Temporary viewer · sources read live from architecture-analysis/
        </div>
      </nav>
      <div className="archv-main">
        <header className="archv-header">
          AROGYADIET — PRODUCT ARCHITECTURE · {activeTitle.toUpperCase()}
        </header>
        <div className="archv-content" id="archv-content">
          <article className="archv-doc">
            {blocks.map((b, idx) => (
              <BlockView
                key={`${active}-b${idx}`}
                block={b}
                docSlug={active}
                index={idx}
                failed={Boolean(failed[idx])}
              />
            ))}
          </article>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Styles (dark doc theme — matches the diagrams' dark node palette)   */
/* ------------------------------------------------------------------ */

const ARCHV_STYLES = `
.archv-root{display:flex;height:100vh;background:#0f172a;color:#e2e8f0;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;}
.archv-sidebar{width:250px;min-width:250px;background:#111827;border-right:1px solid #1f2937;padding:16px 12px;overflow-y:auto;box-sizing:border-box;}
.archv-brand{font-size:13px;letter-spacing:.14em;color:#94a3b8;font-weight:700;margin:4px 8px 16px;}
.archv-navitem{display:block;width:100%;text-align:left;background:none;border:none;color:#cbd5e1;padding:9px 12px;border-radius:8px;cursor:pointer;font-size:14px;font-family:inherit;}
.archv-navitem:hover{background:#1f2937;}
.archv-navitem.active{background:#1e3a8a;color:#fff;font-weight:600;}
.archv-note{margin-top:18px;padding:10px 12px;font-size:11px;color:#64748b;line-height:1.5;}
.archv-main{flex:1;display:flex;flex-direction:column;min-width:0;}
.archv-header{padding:14px 28px;border-bottom:1px solid #1f2937;background:#111827;font-weight:700;letter-spacing:.08em;font-size:13px;color:#94a3b8;}
.archv-content{flex:1;overflow-y:auto;padding:28px 40px 90px;}
.archv-doc{max-width:1000px;margin:0 auto;line-height:1.65;font-size:15px;}
.archv-doc h1{font-size:28px;color:#f8fafc;border-bottom:1px solid #1f2937;padding-bottom:10px;margin:8px 0 20px;}
.archv-doc h2{font-size:21px;color:#f1f5f9;margin:30px 0 12px;}
.archv-doc h3{font-size:17px;color:#e2e8f0;margin:22px 0 8px;}
.archv-doc h4{font-size:15px;color:#e2e8f0;margin:18px 0 6px;}
.archv-doc p{margin:10px 0;}
.archv-doc ul,.archv-doc ol{margin:10px 0;padding-left:22px;}
.archv-doc li{margin:4px 0;}
.archv-doc hr{border:none;border-top:1px solid #1f2937;margin:22px 0;}
.archv-doc blockquote{border-left:3px solid #3b82f6;background:#111a2e;padding:10px 16px;border-radius:0 8px 8px 0;color:#cbd5e1;margin:12px 0;}
.archv-doc table{border-collapse:collapse;margin:14px 0;width:100%;font-size:14px;}
.archv-doc th,.archv-doc td{border:1px solid #334155;padding:8px 12px;text-align:left;vertical-align:top;}
.archv-doc th{background:#1e293b;color:#f1f5f9;font-weight:600;}
.archv-doc tr:nth-child(even) td{background:#111a2e;}
.archv-doc pre{background:#0b1220;border:1px solid #1f2937;padding:14px;border-radius:10px;overflow-x:auto;font-size:13px;line-height:1.5;}
.archv-doc code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;}
.archv-inline-code{background:#1e293b;padding:2px 6px;border-radius:5px;font-size:.9em;color:#fbbf24;}
.archv-doc a{color:#7dd3fc;}
.archv-mermaid{margin:18px 0;overflow-x:auto;background:#0f172a;border:1px solid #1f2937;border-radius:12px;padding:16px;min-height:64px;}
.archv-mermaid svg{max-width:100%;height:auto;}
.archv-mermaid:empty::after{content:"Loading diagram…";color:#64748b;font-size:13px;}

/* --- Diagram frame: toolbar + zoom/pan viewport + fullscreen overlay --- */
.archv-frame{margin:18px 0;}
.archv-tb{display:flex;align-items:center;gap:6px;padding:6px 10px;background:#111827;border:1px solid #1f2937;border-bottom:none;border-radius:10px 10px 0 0;}
.archv-tb button{background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:3px 10px;cursor:pointer;font-size:13px;font-family:inherit;}
.archv-tb button:hover{background:#334155;}
.archv-tb .archv-tb-fs{margin-left:auto;}
.archv-zoom{font-size:12px;color:#94a3b8;min-width:44px;text-align:center;}
.archv-tb-hint{font-size:11px;color:#64748b;margin-left:auto;padding-right:6px;}
.archv-tb .archv-tb-fs{margin-left:0;}
.archv-tb .archv-tb-hint + .archv-tb-fs{margin-left:auto;}
.archv-viewport{overflow:hidden;background:#0f172a;border:1px solid #1f2937;border-radius:0 0 12px 12px;touch-action:none;cursor:grab;min-height:72px;}
.archv-viewport:active{cursor:grabbing;}
.archv-canvas{transform-origin:0 0;padding:16px;display:inline-block;min-width:calc(100% - 32px);}
.archv-canvas .archv-mermaid{margin:0;border:none;background:transparent;padding:0;border-radius:0;}
.archv-fullscreen{position:fixed;inset:0;z-index:60;margin:0;background:rgba(2,6,23,0.97);display:flex;flex-direction:column;padding:14px;box-sizing:border-box;}
.archv-fullscreen .archv-tb{border-radius:10px 10px 0 0;}
.archv-fullscreen .archv-viewport{flex:1;border-radius:0 0 12px 12px;}
`;



