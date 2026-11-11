import {
  ArrowDown,
  Cookie,
  Download,
  FileCode2,
  GitBranch,
  Globe,
  Lock,
  LockOpen,
  Server,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { downloadFile } from "@/lib/redirect-export";
import { toFlowchartSvg, toHar } from "@/lib/redirect-har";
import type { RedirectAnalysis } from "@/lib/redirect-types";
import { StatusBadge } from "./StatusBadge";

function getHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function VisualGraphTab({ result }: { result: RedirectAnalysis }) {
  const totalMs = Math.max(1, result.totalResponseTimeMs);
  let cumulativeMs = 0;

  function handleExportHar() {
    const harContent = toHar([result]);
    const host = getHostname(result.startUrl).replace(/[^a-z0-9.-]+/gi, "-");
    downloadFile(`crosx-trace-${host}.har`, harContent, "application/json");
    toast.success("HTTP Archive (.har) exported");
  }

  function handleExportSvg() {
    const svgContent = toFlowchartSvg(result);
    const host = getHostname(result.startUrl).replace(/[^a-z0-9.-]+/gi, "-");
    downloadFile(`crosx-flowchart-${host}.svg`, svgContent, "image/svg+xml");
    toast.success("Flowchart SVG exported");
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-hairline bg-surface-muted/50 px-3.5 py-2.5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <GitBranch className="size-3.5 text-brand" />
          <span>
            Interactive node topology · {result.hops.length} hop
            {result.hops.length === 1 ? "" : "s"} · {result.totalResponseTimeMs} ms total waterfall
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="subtle" size="sm" onClick={handleExportHar}>
            <Download className="size-3.5 text-brand" />
            Export HAR (.har)
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={handleExportSvg}>
            <FileCode2 className="size-3.5" />
            Export Flowchart (.svg)
          </Button>
        </div>
      </div>

      {/* Visual Flowchart & Waterfall Timeline */}
      <div className="space-y-1.5">
        {result.hops.map((hop, idx) => {
          const host = getHostname(hop.url);
          const prevHost = idx > 0 ? getHostname(result.hops[idx - 1]!.url) : host;
          const domainChanged = idx > 0 && host !== prevHost;
          const isFinal = idx === result.hops.length - 1;

          const startOffsetPct = Math.min(92, Math.round((cumulativeMs / totalMs) * 100));
          const durationPct = Math.max(
            4,
            Math.min(100 - startOffsetPct, Math.round((hop.responseTimeMs / totalMs) * 100)),
          );
          cumulativeMs += Math.max(0, hop.responseTimeMs);

          const cookiesSetCount = hop.forensics?.cookiesSet?.length ?? 0;
          const cookiesSentCount = hop.forensics?.cookiesSent?.length ?? 0;

          return (
            <div key={`${hop.index}-${hop.url}`} className="space-y-1.5">
              <div
                className={`rounded-xl border p-3.5 transition-colors ${
                  isFinal
                    ? "border-success/35 bg-success/5"
                    : domainChanged
                      ? "border-brand/35 bg-brand/5"
                      : "border-hairline bg-surface/70"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-foreground">
                      Hop #{hop.index + 1}
                    </span>
                    <StatusBadge status={hop.status} />
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {hop.mechanismLabel ?? hop.redirectType}
                    </span>
                    <span aria-hidden="true" className="text-muted-foreground">
                      ·
                    </span>
                    <span className="inline-flex items-center gap-1 font-mono text-[11px] text-foreground">
                      <Globe className="size-3 text-brand" />
                      {host}
                    </span>
                    {domainChanged ? (
                      <span className="font-mono text-[10.5px] font-medium text-brand">
                        Cross-domain transition ({prevHost} → {host})
                      </span>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      {hop.protocol === "https" ? (
                        <Lock className="size-3 text-success" />
                      ) : (
                        <LockOpen className="size-3 text-warning" />
                      )}
                      {hop.protocol.toUpperCase()}
                    </span>
                    {hop.ip ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1">
                          <Server className="size-3" />
                          {hop.ip}
                        </span>
                      </>
                    ) : null}
                    {cookiesSetCount > 0 || cookiesSentCount > 0 ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1 text-foreground">
                          <Cookie className="size-3 text-brand" />
                          {cookiesSetCount > 0 ? `+${cookiesSetCount} set` : ""}
                          {cookiesSetCount > 0 && cookiesSentCount > 0 ? " / " : ""}
                          {cookiesSentCount > 0 ? `${cookiesSentCount} sent` : ""}
                        </span>
                      </>
                    ) : null}
                    <span aria-hidden="true">·</span>
                    <span className="font-semibold text-foreground">{hop.responseTimeMs} ms</span>
                  </div>
                </div>

                <p className="mt-1.5 break-all font-mono text-[11.5px] text-muted-foreground">
                  {hop.url}
                </p>

                {/* Waterfall timing bar */}
                <div className="mt-2.5 space-y-1">
                  <div className="relative h-2 w-full overflow-hidden rounded-full bg-surface-muted">
                    <div
                      className={`absolute top-0 h-full rounded-full ${
                        isFinal ? "bg-success" : "bg-brand"
                      }`}
                      style={{
                        left: `${startOffsetPct}%`,
                        width: `${durationPct}%`,
                      }}
                    />
                  </div>
                </div>
              </div>

              {!isFinal ? (
                <div className="flex items-center justify-center py-0.5 text-muted-foreground">
                  <ArrowDown className="size-4 text-brand" />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
