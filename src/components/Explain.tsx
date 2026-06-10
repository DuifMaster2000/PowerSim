// =====================================================================
// Explain mode primitives. Two components share one tooltip popover:
//   <Info topic="..." />              — info icon, returns null when off
//   <Explain topic="..." >text</>     — wraps inline content with a
//                                       dotted underline + hover tooltip
// Both render exactly nothing extra when explainMode is off.
// =====================================================================

import { useState, useRef, useLayoutEffect, type ReactNode } from "react";
import { useStore } from "../store";
import { EXPLAIN, type ExplainEntry } from "../explainContent";

function resolveEntry(topic: string, fallbackTopic?: string): ExplainEntry | null {
  return EXPLAIN[topic] ?? (fallbackTopic ? EXPLAIN[fallbackTopic] ?? null : null);
}

interface TooltipProps {
  anchorRect: DOMRect;
  entry: ExplainEntry;
}

function Tooltip({ anchorRect, entry }: TooltipProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({
    top: anchorRect.bottom + 6,
    left: anchorRect.left,
  });

  useLayoutEffect(() => {
    if (!ref.current) return;
    const tipRect = ref.current.getBoundingClientRect();
    let left = anchorRect.left;
    let top = anchorRect.bottom + 6;
    if (left + tipRect.width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - tipRect.width - 8);
    }
    if (top + tipRect.height > window.innerHeight - 8) {
      top = anchorRect.top - tipRect.height - 6;
    }
    if (left !== pos.left || top !== pos.top) setPos({ top, left });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorRect.left, anchorRect.top, anchorRect.bottom, anchorRect.right]);

  return (
    <div
      ref={ref}
      className="explain-tooltip"
      style={{ position: "fixed", top: pos.top, left: pos.left }}
      role="tooltip"
    >
      <div className="explain-tooltip-title">{entry.title}</div>
      <div className="explain-tooltip-body">{entry.body}</div>
      {entry.formula && (
        <div className="explain-tooltip-formula">
          <code>{entry.formula}</code>
        </div>
      )}
      {entry.typical && (
        <div className="explain-tooltip-meta">Typical: {entry.typical}</div>
      )}
      {entry.example && (
        <div className="explain-tooltip-meta">{entry.example}</div>
      )}
    </div>
  );
}

interface UseTooltipResult {
  anchorRect: DOMRect | null;
  bindings: {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => void;
    onMouseLeave: () => void;
    onFocus: (e: React.FocusEvent<HTMLElement>) => void;
    onBlur: () => void;
  };
}

function useTooltip(): UseTooltipResult {
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const open = (el: HTMLElement) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setAnchorRect(el.getBoundingClientRect()), 250);
  };
  const close = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setAnchorRect(null);
  };

  return {
    anchorRect,
    bindings: {
      onMouseEnter: (e) => open(e.currentTarget),
      onMouseLeave: close,
      onFocus: (e) => open(e.currentTarget),
      onBlur: close,
    },
  };
}

// ---------- Public components ----------

interface ExplainProps {
  topic: string;
  fallbackTopic?: string;
  children: ReactNode;
}

export function Explain({ topic, fallbackTopic, children }: ExplainProps) {
  const explainMode = useStore((s) => s.explainMode);
  const entry = resolveEntry(topic, fallbackTopic);
  const { anchorRect, bindings } = useTooltip();
  if (!explainMode || !entry) return <>{children}</>;
  return (
    <>
      <span className="explain-wrap" tabIndex={0} {...bindings}>
        {children}
      </span>
      {anchorRect && <Tooltip anchorRect={anchorRect} entry={entry} />}
    </>
  );
}

interface InfoProps {
  topic: string;
  fallbackTopic?: string;
}

export function Info({ topic, fallbackTopic }: InfoProps) {
  const explainMode = useStore((s) => s.explainMode);
  const entry = resolveEntry(topic, fallbackTopic);
  const { anchorRect, bindings } = useTooltip();
  if (!explainMode || !entry) return null;
  return (
    <>
      <span className="explain-info" tabIndex={0} aria-label={entry.title} {...bindings}>
        i
      </span>
      {anchorRect && <Tooltip anchorRect={anchorRect} entry={entry} />}
    </>
  );
}
