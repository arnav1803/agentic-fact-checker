import { motion, useReducedMotion } from "framer-motion";
import { scoreBand } from "./verdict";

interface Props {
  score: number;
  size?: number;
}

export function ScoreRing({ score, size = 160 }: Props) {
  const prefersReduced = useReducedMotion();
  const clamped = Math.max(0, Math.min(1, score));
  const band = scoreBand(clamped);
  const radius = size / 2 - 10;
  const circ = 2 * Math.PI * radius;

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Credibility score: ${Math.round(clamped * 100)} out of 100`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={10}
          fill="none"
          className="stroke-white/10"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={10}
          fill="none"
          strokeLinecap="round"
          className={band.stroke}
          strokeDasharray={circ}
          initial={{ strokeDashoffset: circ }}
          animate={{ strokeDashoffset: circ * (1 - clamped) }}
          transition={{
            duration: prefersReduced ? 0 : 1.2,
            ease: "easeOut",
          }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className={`text-4xl font-semibold tabular-nums ${band.color}`}>
          {Math.round(clamped * 100)}
        </span>
        <span className="text-xs text-muted-foreground">out of 100</span>
      </div>
    </div>
  );
}
