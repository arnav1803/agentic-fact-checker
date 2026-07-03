import type { VerdictKind } from "@/lib/types";

export function verdictLabel(v: VerdictKind): string {
  return v === "NOT_ENOUGH_INFO" ? "NOT ENOUGH INFO" : v;
}

export function verdictColor(v: VerdictKind): {
  text: string;
  bg: string;
  ring: string;
  bar: string;
} {
  switch (v) {
    case "SUPPORTS":
      return {
        text: "text-verdict-supports",
        bg: "bg-verdict-supports/15",
        ring: "ring-verdict-supports/30",
        bar: "bg-verdict-supports",
      };
    case "REFUTES":
      return {
        text: "text-verdict-refutes",
        bg: "bg-verdict-refutes/15",
        ring: "ring-verdict-refutes/30",
        bar: "bg-verdict-refutes",
      };
    default:
      return {
        text: "text-verdict-insufficient",
        bg: "bg-verdict-insufficient/15",
        ring: "ring-verdict-insufficient/30",
        bar: "bg-verdict-insufficient",
      };
  }
}

export function scoreBand(score: number): {
  color: string;
  stroke: string;
  label: string;
} {
  if (score >= 0.7)
    return {
      color: "text-verdict-supports",
      stroke: "stroke-verdict-supports",
      label: "Most claims in this article are well-supported.",
    };
  if (score >= 0.4)
    return {
      color: "text-verdict-insufficient",
      stroke: "stroke-verdict-insufficient",
      label: "This article contains a mix of supported and unverified claims.",
    };
  return {
    color: "text-verdict-refutes",
    stroke: "stroke-verdict-refutes",
    label: "Many claims in this article appear unsupported or refuted.",
  };
}

export function safeExternalUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function renderJustification(text: string): Array<
  | { kind: "text"; value: string }
  | { kind: "link"; value: string; href: string }
> {
  const parts: Array<
    { kind: "text"; value: string } | { kind: "link"; value: string; href: string }
  > = [];
  const regex = /(https?:\/\/[^\s)]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last)
      parts.push({ kind: "text", value: text.slice(last, m.index) });
    const safe = safeExternalUrl(m[0]);
    if (safe) parts.push({ kind: "link", value: m[0], href: safe });
    else parts.push({ kind: "text", value: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", value: text.slice(last) });
  return parts;
}

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
