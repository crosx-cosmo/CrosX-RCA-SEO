import { useMutation } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Loader2,
  Monitor,
  ShieldAlert,
  Smartphone,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { evaluateCloakingMatrix } from "@/lib/redirect-rules-codegen";
import { compareUrlAcrossAgents } from "@/lib/redirect-service";
import type { RedirectAnalysis } from "@/lib/redirect-types";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./StatusBadge";

export function CloakingMatrixPanel({ result }: { result: RedirectAnalysis }) {
  const compareMut = useMutation({
    mutationFn: () => compareUrlAcrossAgents(result.startUrl, result.source === "demo"),
    onError: (err: Error) => toast.error(err.message || "Multi-agent comparison failed"),
  });

  const verdict = compareMut.data ? evaluateCloakingMatrix(compareMut.data) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-hairline bg-surface-muted/70 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-semibold text-foreground">
            Multi-Agent Cloaking &amp; Conditional Routing Matrix
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Traces <span className="font-mono text-foreground">{result.startUrl}</span> across{" "}
            <strong className="font-medium text-foreground">Desktop Chrome</strong>,{" "}
            <strong className="font-medium text-foreground">iPhone Safari</strong>, and{" "}
            <strong className="font-medium text-foreground">Googlebot Smartphone</strong> to expose
            SEO cloaking or mobile-only redirect traps.
          </p>
        </div>
        <Button
          type="button"
          variant="hero"
          size="sm"
          disabled={compareMut.isPending}
          onClick={() => compareMut.mutate()}
          className="relative shrink-0 overflow-hidden"
        >
          {compareMut.isPending ? (
            <span
              aria-hidden="true"
              className="animate-shimmer pointer-events-none absolute inset-0"
            />
          ) : null}
          {compareMut.isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Sparkles className="size-3.5" />
          )}
          {compareMut.isPending
            ? "Comparing 3 agents…"
            : verdict
              ? "Re-run comparison"
              : "Run 3-Agent Cloaking Check"}
        </Button>
      </div>

      {compareMut.isPending ? (
        <div
          role="status"
          aria-live="polite"
          className="relative space-y-2.5 overflow-hidden rounded-xl border border-hairline bg-surface-muted/60 p-4"
        >
          <p className="text-xs font-medium text-muted-foreground">
            Simultaneously probing Desktop Chrome, Mobile Safari (iPhone), and Googlebot Smartphone…
          </p>
          {Array.from({ length: 3 }).map((_, idx) => (
            <div key={idx} className="flex items-center justify-between gap-4 py-1.5">
              <Skeleton className="h-4 w-40 rounded-md" />
              <Skeleton className="h-4 w-56 rounded-md" />
            </div>
          ))}
        </div>
      ) : null}

      {verdict ? (
        <div className="space-y-3">
          <div
            className={cn(
              "flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-xs",
              verdict.severity === "critical" &&
                "border-destructive/35 bg-destructive/10 text-destructive",
              verdict.severity === "warning" &&
                "border-warning/40 bg-warning/10 text-warning-foreground",
              verdict.severity === "clean" && "border-success/30 bg-success/10 text-success",
            )}
          >
            {verdict.severity === "critical" ? (
              <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            ) : verdict.severity === "warning" ? (
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            ) : (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            )}
            <div className="min-w-0 space-y-1">
              <p className="font-semibold">{verdict.summary}</p>
              {verdict.findings.length > 0 ? (
                <ul className="list-disc space-y-0.5 pl-4 text-[11.5px] opacity-90">
                  {verdict.findings.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-hairline bg-surface">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-hairline bg-surface-muted/70 text-[11px] font-semibold text-muted-foreground">
                <tr>
                  <th className="px-3.5 py-2.5">User-Agent Profile</th>
                  <th className="px-3.5 py-2.5">Status</th>
                  <th className="px-3.5 py-2.5 text-right">Hops</th>
                  <th className="px-3.5 py-2.5 text-right">Latency</th>
                  <th className="px-3.5 py-2.5">Final Destination</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {verdict.entries.map((entry) => {
                  const Icon = entry.preset.startsWith("googlebot")
                    ? Bot
                    : entry.preset.startsWith("mobile")
                      ? Smartphone
                      : Monitor;
                  return (
                    <tr key={entry.preset} className="hover:bg-surface-muted/40">
                      <td className="whitespace-nowrap px-3.5 py-2.5 font-medium text-foreground">
                        <span className="inline-flex items-center gap-2">
                          <Icon className="size-3.5 shrink-0 text-brand" />
                          {entry.label}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3.5 py-2.5">
                        {entry.finalStatus ? (
                          <StatusBadge status={entry.finalStatus} />
                        ) : (
                          <span className="font-mono text-destructive">ERR</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3.5 py-2.5 text-right font-mono tabular-nums text-foreground">
                        {entry.totalRedirects}
                      </td>
                      <td className="whitespace-nowrap px-3.5 py-2.5 text-right font-mono tabular-nums text-muted-foreground">
                        {entry.totalResponseTimeMs} ms
                      </td>
                      <td className="max-w-[320px] truncate px-3.5 py-2.5 font-mono text-[11.5px] text-foreground">
                        {entry.finalUrl}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
