import { useEffect, useRef, useState } from "react";
import {
  ClipboardPaste,
  Eraser,
  FileText,
  Link2,
  Loader2,
  Scale,
  Sparkles,
  Users,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";

import { getPrefs, loadDraft, saveDraft, setPrefs } from "@/lib/user-store";
import type { VerificationMethod } from "@/lib/types";

export const SAMPLE_ARTICLE =
  "The Indian government announced today that it will launch a ₹10,000 crore fund to support AI startups. According to the Finance Minister, the first grants will be disbursed by December 2026. The initiative aims to create 50,000 new jobs in the AI sector over the next three years.";

const MAX_CHARS = 20_000;
const MIN_CHARS = 40;
const MIN_QUESTION_CHARS = 8;
const DRAFT_DEBOUNCE_MS = 600;

// Mirrors the backend's is_question(): short questions are answered, not
// fact-checked, so they don't need an article's minimum length.
const QUESTION_MAX_CHARS = 400;
const QUESTION_START =
  /^(what|who|whom|whose|when|where|why|how|which|is|are|was|were|do|does|did|can|could|will|would|should|has|have|had|tell me|explain|describe)\b/i;

function looksLikeQuestion(text: string) {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= QUESTION_MAX_CHARS && (t.endsWith("?") || QUESTION_START.test(t));
}

type Mode = "text" | "url";

interface Props {
  loading: boolean;
  serverError: string | null;
  userKey: string;
  onSubmit: (input: AnalyzeInput) => void;
}

export interface AnalyzeInput {
  article?: string;
  url?: string;
  maxClaims: number;
  verification: VerificationMethod;
  debateRounds: number;
}

export function InputForm({ loading, serverError, userKey, onSubmit }: Props) {
  const [mode, setMode] = useState<Mode>("text");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [maxClaims, setMaxClaims] = useState(5);
  const [verification, setVerification] = useState<VerificationMethod>("madam");
  const [debateRounds, setDebateRounds] = useState(2);
  const [touched, setTouched] = useState(false);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSaveRef = useRef(true);

  // Restore per-user draft + preferred claim count on mount / user switch
  useEffect(() => {
    const prefs = getPrefs(userKey);
    autoSaveRef.current = prefs.autoSaveDraft;
    setMaxClaims(prefs.defaultMaxClaims);
    setVerification(prefs.verification);
    setDebateRounds(prefs.debateRounds);
    const draft = loadDraft(userKey);
    if (draft) {
      setText(draft);
      setMode("text");
      toast.info("Restored your unsent draft", { id: "draft-restore" });
    } else {
      setText("");
    }
    setTouched(false);
  }, [userKey]);

  // Debounced draft autosave (text mode only)
  const updateText = (value: string) => {
    setText(value);
    if (!autoSaveRef.current) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => saveDraft(userKey, value), DRAFT_DEBOUNCE_MS);
  };

  const trimmed = text.trim();
  const trimmedUrl = url.trim();
  const wordCount = trimmed ? trimmed.split(/\s+/).length : 0;
  const charCount = text.length;

  let validationError: string | null = null;
  if (mode === "text") {
    if (charCount > MAX_CHARS)
      validationError = `Article is too long (max ${MAX_CHARS.toLocaleString()} characters).`;
    else if (trimmed.length === 0)
      validationError = "Please paste an article to analyze, or ask a question.";
    else if (looksLikeQuestion(trimmed)) {
      if (trimmed.length < MIN_QUESTION_CHARS) validationError = "Please ask a complete question.";
    } else if (trimmed.length < MIN_CHARS)
      validationError = `Article is too short (min ${MIN_CHARS} characters). To ask a question instead, start with a question word or end with "?".`;
  } else {
    if (trimmedUrl.length === 0) validationError = "Please enter an article URL.";
    else if (!/^https?:\/\/\S+\.\S+/i.test(trimmedUrl))
      validationError = "Enter a valid http(s):// URL.";
  }

  const isInvalid = validationError !== null;
  const showError = (touched && isInvalid) || serverError;

  const submit = () => {
    setTouched(true);
    if (isInvalid || loading) return;
    const how = { maxClaims, verification, debateRounds };
    if (mode === "text") onSubmit({ article: trimmed, ...how });
    else onSubmit({ url: trimmedUrl, ...how });
  };

  const pasteFromClipboard = async () => {
    try {
      const clip = await navigator.clipboard.readText();
      if (!clip.trim()) {
        toast.info("Clipboard is empty");
        return;
      }
      if (mode === "text") updateText(clip);
      else setUrl(clip.trim());
      setTouched(false);
    } catch {
      toast.error("Couldn't read the clipboard. Paste manually with Ctrl+V.");
    }
  };

  const clearInput = () => {
    if (mode === "text") updateText("");
    else setUrl("");
    setTouched(false);
  };

  const hasInput = mode === "text" ? text.length > 0 : url.length > 0;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="glass-card space-y-4 p-6"
    >
      <div>
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-1 rounded border border-border bg-secondary/50 p-0.5 text-xs">
            <ModeTab
              active={mode === "text"}
              onClick={() => {
                setMode("text");
                setTouched(false);
              }}
              icon={<FileText className="size-3.5" />}
              label="Paste text"
            />
            <ModeTab
              active={mode === "url"}
              onClick={() => {
                setMode("url");
                setTouched(false);
              }}
              icon={<Link2 className="size-3.5" />}
              label="From URL"
            />
          </div>
          <div className="flex items-center gap-3 text-xs">
            <button
              type="button"
              onClick={pasteFromClipboard}
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              <ClipboardPaste className="size-3.5" /> Paste
            </button>
            {hasInput && (
              <button
                type="button"
                onClick={clearInput}
                className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
              >
                <Eraser className="size-3.5" /> Clear
              </button>
            )}
          </div>
        </div>

        {mode === "text" ? (
          <>
            <textarea
              id="article"
              value={text}
              onChange={(e) => updateText(e.target.value)}
              onBlur={() => setTouched(true)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={8}
              placeholder="Paste a news article, or ask a question like “What happened at LPU this week?” (Ctrl+Enter to run)"
              aria-invalid={showError ? true : undefined}
              aria-describedby="article-help article-error"
              className="w-full max-h-[420px] resize-y rounded-lg border border-border bg-card p-4 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus:border-primary/60 focus:outline-none"
            />
            <div
              id="article-help"
              className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground"
            >
              <span>
                {wordCount.toLocaleString()} words • {charCount.toLocaleString()}/
                {MAX_CHARS.toLocaleString()} chars
              </span>
              <button
                type="button"
                onClick={() => {
                  updateText(SAMPLE_ARTICLE);
                  setTouched(false);
                }}
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                <Wand2 className="size-3.5" /> Try with sample article
              </button>
            </div>
          </>
        ) : (
          <>
            <input
              id="article-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder="https://example.com/news/some-article"
              aria-invalid={showError ? true : undefined}
              aria-describedby="article-help article-error"
              className="w-full rounded-lg border border-border bg-card px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary/60 focus:outline-none"
            />
            <p id="article-help" className="mt-1.5 text-xs text-muted-foreground">
              The backend fetches the page and extracts the article text automatically.
            </p>
          </>
        )}

        {showError ? (
          <p id="article-error" role="alert" className="mt-2 text-xs text-destructive">
            {serverError ?? validationError}
          </p>
        ) : null}
      </div>

      <div>
        <label
          htmlFor="max-claims"
          className="mb-2 flex items-center justify-between text-sm font-medium"
        >
          <span>Max claims to extract</span>
          <span className="tabular-nums text-primary">{maxClaims}</span>
        </label>
        <input
          id="max-claims"
          type="range"
          min={1}
          max={10}
          step={1}
          value={maxClaims}
          onChange={(e) => setMaxClaims(Number(e.target.value))}
          className="w-full accent-[color:var(--color-primary)]"
        />
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">How should claims be checked?</legend>
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
          <VerifyOption
            active={verification === "standard"}
            onClick={() => {
              setVerification("standard");
              setPrefs(userKey, { verification: "standard" });
            }}
            icon={<Scale className="size-4" />}
            title="Quick check"
            body="One model reads all the evidence and rules on every claim at once."
          />
          <VerifyOption
            active={verification === "madam"}
            onClick={() => {
              setVerification("madam");
              setPrefs(userKey, { verification: "madam" });
            }}
            icon={<Users className="size-4" />}
            title="Agent debate"
            body="Each source gets its own agent. Sources that agree form a group, opposing groups argue it out, and an aggregator rules (MADAM-RAG)."
          />
        </div>
        {verification === "madam" ? (
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            Copies of the same story count once, and the group round only happens when sources
            disagree. Usually under a minute per claim, on its own model so quick checks stay
            available.
          </p>
        ) : null}
      </fieldset>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">Powered by Groq LLM + live web search</p>
        <button
          type="submit"
          disabled={loading || isInvalid}
          className={`inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition disabled:cursor-not-allowed disabled:opacity-50 ${
            !loading && !isInvalid ? "pulse-glow hover:opacity-90" : ""
          }`}
        >
          {loading ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Analyzing...
            </>
          ) : (
            <>
              <Sparkles className="size-4" /> Analyze Article
            </>
          )}
        </button>
      </div>
    </form>
  );
}

function ModeTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-semibold transition border ${
        active
          ? "bg-card border-border text-foreground shadow-sm"
          : "border-transparent text-muted-foreground hover:text-foreground hover:bg-card/40"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function VerifyOption({
  active,
  onClick,
  icon,
  title,
  body,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`flex gap-3 rounded-lg border p-3 text-left transition ${
        active ? "border-primary/60 bg-primary/10" : "border-border bg-card hover:border-primary/30"
      }`}
    >
      <span className={`mt-0.5 ${active ? "text-primary" : "text-muted-foreground"}`}>{icon}</span>
      <span>
        <span className="block text-sm font-semibold text-foreground">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{body}</span>
      </span>
    </button>
  );
}
