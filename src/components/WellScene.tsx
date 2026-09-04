"use client";
import type { CSSProperties } from "react";

/**
 * The well itself: the drawing, and the three things that happen at its mouth.
 *
 *   idle      it sits there, the bucket hanging over the rim.
 *   dropping  the question, written on a slip of paper, falls in.
 *   loading   the law comes back out — article numbers, "§", a rolled-up
 *             judgment — arcing up out of the dark while the search runs.
 *   answered  it settles, and shrinks to make room for the answer.
 *
 * The loading state is doing a job beyond decoration. Retrieval plus two model
 * calls is several seconds, which is a long time in front of a spinner and no
 * time at all in front of something to watch; and what comes out of the well
 * says what the well is doing — it is fetching *law*, not thinking.
 *
 * Everything here is CSS animation on transform and opacity, so it composites
 * on the GPU and costs nothing while it loops. Under prefers-reduced-motion
 * the whole lot is switched off in globals.css and the scene is simply a
 * drawing of a well.
 */

export type WellPhase = "idle" | "dropping" | "loading" | "answered";

interface Props {
  phase: WellPhase;
  /** The question, shown on the slip of paper as it falls. */
  question: string;
  /** Shrinks the scene once there is an answer worth the space instead. */
  compact: boolean;
}

/**
 * What comes up out of the well, and where each one flies.
 *
 * `x` is how far it drifts sideways, `h` how high it gets, and the delays are
 * spread evenly across the cycle so the stream is continuous rather than
 * pulsing — and so that no more than two or three are ever in the air at
 * once, which is the difference between a well working and confetti.
 * They are the citations this app is built around — an article, a paragraph,
 * a section mark — because that is what the well is actually drawing up.
 */
const RELICS: { label: string; x: number; h: number; dur: number; delay: number; rot: number }[] = [
  { label: "§", x: -104, h: 116, dur: 3.0, delay: 0, rot: -26 },
  { label: "5. gr.", x: 88, h: 100, dur: 3.2, delay: 0.5, rot: 20 },
  { label: "1. mgr.", x: -62, h: 128, dur: 3.4, delay: 1.0, rot: 12 },
  { label: "lög", x: 112, h: 86, dur: 2.9, delay: 1.5, rot: 28 },
  { label: "dómur", x: -96, h: 96, dur: 3.1, delay: 2.0, rot: -18 },
  { label: "2. tölul.", x: 56, h: 124, dur: 3.3, delay: 2.5, rot: 9 },
];

export function WellScene({ phase, question, compact }: Props) {
  return (
    <div className={`well-stage${compact ? " well-stage--compact" : ""}`} aria-hidden="true">
      <WellDrawing />

      {/* Everything that moves lives above the drawing, so it passes in front
          of the posts and the rope on its way up rather than behind them. */}
      <div className="well-mouth">
        {phase === "loading" && (
          <>
            <span className="well-ripple" />
            <span className="well-ripple well-ripple--late" />
            {RELICS.map((relic, i) => (
              <span
                key={i}
                className="well-relic"
                style={
                  {
                    "--relic-x": `${relic.x}px`,
                    "--relic-h": `${relic.h}px`,
                    "--relic-dur": `${relic.dur}s`,
                    "--relic-delay": `${relic.delay}s`,
                    "--relic-rot": `${relic.rot}deg`,
                  } as CSSProperties
                }
              >
                <span className="well-relic-lift">
                  <span className="well-relic-chip">{relic.label}</span>
                </span>
              </span>
            ))}
          </>
        )}

        {phase === "dropping" && (
          <span className="well-note">
            <span className="well-note-text">{question}</span>
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * A stone well, drawn in the app's own two colours.
 *
 * No roof over the mouth, which a wishing well usually has: the whole point of
 * the scene is that things come *up out of it*, and a lid over the shaft
 * quietly argues the opposite. What is left — the posts, the windlass, the
 * rope and the bucket on the rim — still reads as a well at a glance, and
 * leaves the sky above the mouth clear for the law to fly through. The
 * launcher's small mark keeps its roof, where the silhouette has to do the
 * work at 20 pixels.
 */
function WellDrawing() {
  return (
    <svg className="well-svg" viewBox="0 0 240 200" role="img" aria-label="Lögbrunnur">
      <defs>
        <linearGradient id="well-stone" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#E7EBF2" />
          <stop offset="55%" stopColor="#C7D0DF" />
          <stop offset="100%" stopColor="#A2AEC4" />
        </linearGradient>
        <linearGradient id="well-rim" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#C3CCDC" />
          <stop offset="45%" stopColor="#E9EDF4" />
          <stop offset="100%" stopColor="#B8C2D4" />
        </linearGradient>
        <radialGradient id="well-mouth" cx="50%" cy="35%" r="75%">
          <stop offset="0%" stopColor="#22304C" />
          <stop offset="55%" stopColor="#121C31" />
          <stop offset="100%" stopColor="#070B14" />
        </radialGradient>
      </defs>

      {/* the ground it stands on */}
      <ellipse cx="120" cy="190" rx="76" ry="8" fill="#16233B" opacity="0.07" />

      {/* the frame: two posts, a beam, and the windlass the rope winds on */}
      <rect x="57" y="44" width="9" height="86" rx="2" fill="#7C6449" />
      <rect x="174" y="44" width="9" height="86" rx="2" fill="#6B5540" />
      <rect x="53" y="42" width="134" height="8" rx="4" fill="#8A7053" />
      <rect x="98" y="45" width="44" height="16" rx="8" fill="#9C8161" />
      <path d="M142 53 h9 v12" fill="none" stroke="#6B5540" strokeWidth="3" strokeLinecap="round" />

      {/* the rope, and the bucket hanging over the rim */}
      <path d="M160 50 L160 96" stroke="#B9A184" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M148 98 Q160 90 172 98" fill="none" stroke="#8A7053" strokeWidth="2" />
      <path d="M147 98 L173 98 L169 120 L151 120 Z" fill="#8A7053" />
      <path d="M147 98 L173 98 L172 103 L148 103 Z" fill="#A0855F" />
      <path d="M151 120 L169 120 L168 123 L152 123 Z" fill="#6B5540" />

      {/* the shaft: taller than it is wide, which is what makes it a well and
          not a basin */}
      <path d="M64 126 Q64 176 72 186 L168 186 Q176 176 176 126 Z" fill="url(#well-stone)" />
      {/* courses of stone: enough to read as masonry, not enough to fuss */}
      <g stroke="#16233B" strokeOpacity="0.15" fill="none" strokeWidth="1.4">
        <path d="M65 141 H175" />
        <path d="M66 156 H174" />
        <path d="M68 171 H172" />
        <path d="M92 126 V141" />
        <path d="M120 126 V141" />
        <path d="M148 126 V141" />
        <path d="M78 141 V156" />
        <path d="M106 141 V156" />
        <path d="M134 141 V156" />
        <path d="M162 141 V156" />
        <path d="M92 156 V171" />
        <path d="M120 156 V171" />
        <path d="M148 156 V171" />
        <path d="M80 171 V186" />
        <path d="M120 171 V186" />
        <path d="M160 171 V186" />
      </g>

      {/* the rim, and the dark of the shaft */}
      <ellipse cx="120" cy="126" rx="58" ry="14" fill="url(#well-rim)" />
      <ellipse cx="120" cy="126" rx="58" ry="14" fill="none" stroke="#16233B" strokeOpacity="0.2" />
      <ellipse cx="120" cy="127" rx="46" ry="10" fill="url(#well-mouth)" />
      {/* water, far down */}
      <ellipse cx="120" cy="129" rx="18" ry="3.4" fill="#24418E" opacity="0.55" />
      <path d="M110 128.5 Q116 126.6 123 128.5" fill="none" stroke="#8FA6D8" strokeWidth="1.2" opacity="0.65" />
    </svg>
  );
}
