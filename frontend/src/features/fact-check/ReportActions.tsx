import { toast } from "sonner";
import { Copy, Download, FileJson } from "lucide-react";
import type { FactCheckResult } from "@/lib/types";
import { copyText, downloadFile, resultToMarkdown } from "@/lib/report";

/** Copy / download buttons shared by fact-check and answer results. */
export function ReportActions({ result }: { result: FactCheckResult }) {
  const stamp = (result.created_at ?? new Date().toISOString()).slice(0, 10);
  const prefix = result.mode === "answer" ? "answer" : "factcheck";

  const copyReport = async () => {
    const ok = await copyText(resultToMarkdown(result));
    if (ok) toast.success("Report copied to clipboard");
    else toast.error("Couldn't copy — your browser blocked clipboard access");
  };

  const downloadMarkdown = () => {
    downloadFile(`${prefix}-${stamp}-${result._id}.md`, resultToMarkdown(result), "text/markdown");
    toast.success("Markdown report downloaded");
  };

  const downloadJson = () => {
    downloadFile(
      `${prefix}-${stamp}-${result._id}.json`,
      JSON.stringify(result, null, 2),
      "application/json",
    );
    toast.success("JSON downloaded");
  };

  return (
    <div className="flex flex-wrap gap-2">
      <ActionButton onClick={copyReport} icon={<Copy className="size-3.5" />}>
        Copy report
      </ActionButton>
      <ActionButton onClick={downloadMarkdown} icon={<Download className="size-3.5" />}>
        Markdown
      </ActionButton>
      <ActionButton onClick={downloadJson} icon={<FileJson className="size-3.5" />}>
        JSON
      </ActionButton>
    </div>
  );
}

function ActionButton({
  onClick,
  icon,
  children,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-accent"
    >
      {icon}
      {children}
    </button>
  );
}
