import ReactMarkdown, { type Components } from "react-markdown";

/** LLMs often bullet with "•", which markdown doesn't recognise as a list. */
function normalizeBullets(text: string) {
  return text.replace(/^([ \t]*)•[ \t]*/gm, "$1- ");
}

const components: Components = {
  p: ({ children }) => <p className="leading-relaxed">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed [&>ul]:mt-1">{children}</li>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline">
      {children}
    </a>
  ),
  // Section titles are rendered by the surrounding card, so demote any inline headings.
  h1: ({ children }) => <p className="font-semibold">{children}</p>,
  h2: ({ children }) => <p className="font-semibold">{children}</p>,
  h3: ({ children }) => <p className="font-semibold">{children}</p>,
};

/** Renders LLM-written markdown with the app's typography. */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={`space-y-2 text-sm text-foreground ${className ?? ""}`}>
      <ReactMarkdown components={components}>{normalizeBullets(children)}</ReactMarkdown>
    </div>
  );
}
