import { useState } from "react";
import { Loader2, Sparkles, Wand2 } from "lucide-react";

export const SAMPLE_ARTICLE =
  "The Indian government announced today that it will launch a ₹10,000 crore fund to support AI startups. According to the Finance Minister, the first grants will be disbursed by December 2026. The initiative aims to create 50,000 new jobs in the AI sector over the next three years.";

const MAX_CHARS = 20_000;
const MIN_CHARS = 40;

interface Props {
  loading: boolean;
  serverError: string | null;
  onSubmit: (article: string, maxClaims: number) => void;
}

export function InputForm({ loading, serverError, onSubmit }: Props) {
  const [text, setText] = useState("");
  const [maxClaims, setMaxClaims] = useState(5);
  const [touched, setTouched] = useState(false);

  const trimmed = text.trim();
  const wordCount = trimmed ? trimmed.split(/\s+/).length : 0;
  const charCount = text.length;

  let validationError: string | null = null;
  if (charCount > MAX_CHARS)
    validationError = `Article is too long (max ${MAX_CHARS.toLocaleString()} characters).`;
  else if (trimmed.length === 0)
    validationError = "Please paste an article to analyze.";
  else if (trimmed.length < MIN_CHARS)
    validationError = `Article is too short (min ${MIN_CHARS} characters).`;

  const isInvalid = validationError !== null;
  const showError = (touched && isInvalid) || serverError;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (isInvalid || loading) return;
        onSubmit(trimmed, maxClaims);
      }}
      className="glass-card space-y-4 p-6"
    >
      <div>
        <label
          htmlFor="article"
          className="mb-2 block text-sm font-medium text-foreground"
        >
          Article text
        </label>
        <textarea
          id="article"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => setTouched(true)}
          rows={8}
          placeholder="Paste your news article here..."
          aria-invalid={showError ? true : undefined}
          aria-describedby="article-help article-error"
          className="w-full max-h-[420px] resize-y rounded-xl border border-white/10 bg-black/30 p-4 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/70 focus:border-primary/60 focus:outline-none"
        />
        <div
          id="article-help"
          className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground"
        >
          <span>
            {wordCount.toLocaleString()} words •{" "}
            {charCount.toLocaleString()}/{MAX_CHARS.toLocaleString()} chars
          </span>
          <button
            type="button"
            onClick={() => {
              setText(SAMPLE_ARTICLE);
              setTouched(false);
            }}
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            <Wand2 className="size-3.5" /> Try with sample article
          </button>
        </div>
        {showError ? (
          <p
            id="article-error"
            role="alert"
            className="mt-2 text-xs text-destructive"
          >
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Powered by Groq LLM + DuckDuckGo Search
        </p>
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
