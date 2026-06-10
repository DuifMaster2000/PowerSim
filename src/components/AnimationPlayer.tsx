// =====================================================================
// Newton-Raphson iteration scrubber. Lives at the bottom of the
// ResultsPanel after a load-flow run with captureHistory enabled (i.e.
// when Explain mode is on). Lets the user play/scrub through the
// iterations and watch bus voltages settle on the canvas.
// =====================================================================

import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import type { IterationSnapshot } from "../types";

function MismatchChart({
  history,
  cursor,
}: {
  history: IterationSnapshot[];
  cursor: number;
}) {
  const w = 220;
  const h = 36;
  if (history.length === 0) return null;

  const maxLog = Math.max(
    ...history.map((s) => Math.log10(Math.max(s.maxMismatch, 1e-12))),
  );
  const minLog = Math.min(
    ...history.map((s) => Math.log10(Math.max(s.maxMismatch, 1e-12))),
  );
  const span = Math.max(maxLog - minLog, 1);

  const xAt = (i: number) =>
    history.length === 1 ? w / 2 : 4 + (i / (history.length - 1)) * (w - 8);
  const yAt = (m: number) => {
    const l = Math.log10(Math.max(m, 1e-12));
    return h - 4 - ((l - minLog) / span) * (h - 8);
  };

  const path = history
    .map((s, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yAt(s.maxMismatch).toFixed(1)}`)
    .join(" ");

  return (
    <svg className="anim-chart" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth={1.4} />
      {history.map((s, i) => (
        <circle key={i} cx={xAt(i)} cy={yAt(s.maxMismatch)} r={1.8} fill="var(--accent)" />
      ))}
      <line
        x1={xAt(cursor)}
        x2={xAt(cursor)}
        y1={2}
        y2={h - 2}
        stroke="var(--warn)"
        strokeWidth={1}
        strokeDasharray="2 2"
      />
    </svg>
  );
}

export function AnimationPlayer() {
  const loadFlow = useStore((s) => s.loadFlow);
  const animationIter = useStore((s) => s.animationIter);
  const setAnimationIter = useStore((s) => s.setAnimationIter);
  const history = loadFlow?.history ?? [];

  const [playing, setPlaying] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // If the underlying history changes (new run), stop any in-flight playback.
  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setPlaying(false);
  }, [history]);

  if (history.length === 0) return null;

  const last = history.length - 1;
  const current = history[Math.min(animationIter, last)];

  const stop = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setPlaying(false);
  };

  const play = () => {
    if (playing) {
      stop();
      return;
    }
    setPlaying(true);
    const startFrom = animationIter >= last ? 0 : animationIter;
    setAnimationIter(startFrom);
    let i = startFrom;
    timerRef.current = setInterval(() => {
      i += 1;
      if (i >= history.length) {
        stop();
        setAnimationIter(last);
        return;
      }
      setAnimationIter(i);
    }, 350);
  };

  return (
    <div className="anim-player">
      <button className="primary" onClick={play} title="Play / pause iteration playback">
        {playing ? "Pause" : "▶ Play"}
      </button>
      <button
        onClick={() => {
          stop();
          setAnimationIter(last);
        }}
        title="Jump to converged state"
      >
        Final
      </button>
      <input
        type="range"
        min={0}
        max={last}
        step={1}
        value={Math.min(animationIter, last)}
        onChange={(e) => {
          stop();
          setAnimationIter(parseInt(e.target.value, 10));
        }}
      />
      <span className="anim-meta">
        iter {current.iter} / {last} · max |Δ| ={" "}
        <span style={{ color: current.maxMismatch < 1e-6 ? "var(--good)" : "var(--warn)" }}>
          {current.maxMismatch.toExponential(2)}
        </span>
      </span>
      <MismatchChart history={history} cursor={Math.min(animationIter, last)} />
    </div>
  );
}
