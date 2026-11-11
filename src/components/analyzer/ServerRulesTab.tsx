import { Check, Copy, Download, Terminal, Zap } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { downloadFile } from "@/lib/redirect-export";
import { generateServerRedirectRules, type ServerPlatform } from "@/lib/redirect-rules-codegen";
import type { RedirectAnalysis } from "@/lib/redirect-types";
import { cn } from "@/lib/utils";

const PLATFORMS: ServerPlatform[] = [
  "nginx",
  "apache",
  "cloudflare",
  "cloudflare-worker",
  "wordpress",
  "vercel",
  "netlify",
];

export function ServerRulesTab({ result }: { result: RedirectAnalysis }) {
  const [platform, setPlatform] = useState<ServerPlatform>("nginx");
  const [copied, setCopied] = useState(false);

  const generated = generateServerRedirectRules(result);
  const active = generated.snippets[platform];

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(active.code);
      setCopied(true);
      toast.success(`${active.label} rule copied`);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Clipboard access blocked");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 rounded-xl border border-hairline bg-surface-muted/70 p-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-0.5">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <Zap className="size-3.5 shrink-0 text-brand" />
            {generated.needsConsolidation
              ? `Direct 301 Hop Consolidation (${generated.hopsSaved > 0 ? `saves ${generated.hopsSaved} intermediate hop${generated.hopsSaved === 1 ? "" : "s"}` : "upgrades temporary hop to 301"})`
              : "Direct 301 Server Redirect Rule"}
          </p>
          <p className="text-[11.5px] leading-relaxed text-muted-foreground">{generated.reason}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" variant="subtle" size="sm" onClick={handleCopy}>
            {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
            {copied ? "Copied" : "Copy rule"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              downloadFile(active.filename, active.code, "text/plain;charset=utf-8");
              toast.success(`Downloaded ${active.filename}`);
            }}
          >
            <Download className="size-3.5" />
            {active.filename}
          </Button>
        </div>
      </div>

      {/* Platform segmented selector */}
      <div
        role="tablist"
        aria-label="Server redirect rule format"
        className="flex flex-wrap items-center gap-1 rounded-xl border border-hairline bg-surface-muted p-1"
      >
        {PLATFORMS.map((key) => {
          const item = generated.snippets[key];
          const isSelected = platform === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={isSelected}
              onClick={() => setPlatform(key)}
              className={cn(
                "cursor-pointer whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                isSelected
                  ? "bg-surface text-foreground shadow-soft"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-xl border border-hairline bg-surface">
        <div className="flex items-center justify-between border-b border-hairline bg-surface-muted/60 px-3.5 py-2 font-mono text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Terminal className="size-3 text-brand" />
            {active.filename}
          </span>
          <span>{generated.sourcePath} → 301 Permanent</span>
        </div>
        <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-foreground">
          <code>{active.code}</code>
        </pre>
      </div>
    </div>
  );
}
