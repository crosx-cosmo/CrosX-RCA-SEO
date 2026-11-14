import {
  ArrowRight,
  CalendarClock,
  Download,
  ExternalLink,
  FileCheck2,
  FileCode2,
  FileJson,
  FileText,
  Link2,
  Smartphone,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { downloadFile, toJson, toReport, toSeoAuditCsv } from "@/lib/redirect-export";
import { toFlowchartSvg, toHar } from "@/lib/redirect-har";
import type { RedirectAnalysis, UserAgentPreset } from "@/lib/redirect-types";
import { ChainTab } from "./ChainTab";
import { CloakingMatrixPanel } from "./CloakingMatrixPanel";
import { CopyButton } from "./CopyButton";
import { HeadersTab } from "./HeadersTab";
import { RawTab } from "./RawTab";
import { SeoTab } from "./SeoTab";
import { ServerRulesTab } from "./ServerRulesTab";
import { ShareButton } from "./ShareButton";
import { SummaryCards } from "./SummaryCards";
import { ThreatScannerTab } from "./ThreatScannerTab";
import { TrackingTab } from "./TrackingTab";
import { VisualGraphTab } from "./VisualGraphTab";

const SECTIONS = [
  {
    value: "chain",
    label: "Redirect chain & waterfall",
    description: "Every hop, status and latency waterfall",
  },
  {
    value: "graph",
    label: "Visual redirect graph & HAR export",
    description: "Interactive flowchart, domain transitions, waterfall & .har / .svg export",
  },
  {
    value: "threat",
    label: "Phishing, malware & threat intelligence scanner",
    description: "Trust score (0–100), Punycode homographs, brand spoofing & security headers",
  },
  {
    value: "seo",
    label: "SEO signals & SERP preview",
    description: "Canonical, robots, SERP & social cards",
  },
  {
    value: "rules",
    label: "Server redirect rules",
    description: "Nginx, Apache .htaccess, Cloudflare, Vercel & Netlify 301",
  },
  {
    value: "cloaking",
    label: "Multi-agent cloaking check",
    description: "Compare Desktop, Mobile & Googlebot routing",
  },
  { value: "tracking", label: "Tracking parameters", description: "Affiliate and UTM diffs" },
  { value: "headers", label: "Response headers", description: "Per-hop HTTP headers" },
  { value: "raw", label: "Raw data", description: "Unmodified analysis payload" },
] as const;

function formatDate(iso: string | undefined) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function slug(url: string) {
  try {
    const u = new URL(url);
    return (
      (u.hostname + u.pathname)
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || "report"
    );
  } catch {
    return "report";
  }
}

export function ReportView({
  result,
  shareId,
  onRetryTrace,
}: {
  result: RedirectAnalysis;
  shareId?: string | undefined;
  onRetryTrace?: (url: string, userAgent?: UserAgentPreset) => void;
}) {
  const [continuationUrl, setContinuationUrl] = useState("");
  const analyzedAt = formatDate(result.analyzedAt);
  const base = `crosx-redirect-report-${slug(result.startUrl)}`;
  const lastHop = result.hops[result.hops.length - 1];
  const isUpstreamGate =
    result.finalDestinationConfirmed === false &&
    Boolean(lastHop) &&
    (lastHop!.status === 403 ||
      lastHop!.status === 406 ||
      lastHop!.status === 429 ||
      lastHop!.status === 503);

  function download(kind: "txt" | "json" | "seo-csv" | "har" | "svg") {
    if (kind === "txt") {
      downloadFile(`${base}.txt`, toReport([result]), "text/plain");
      toast.success("Report downloaded");
    } else if (kind === "seo-csv") {
      downloadFile(`${base}-seo-audit.csv`, toSeoAuditCsv([result]), "text/csv");
      toast.success("SEO Audit CSV downloaded");
    } else if (kind === "har") {
      downloadFile(`${base}.har`, toHar([result]), "application/json");
      toast.success("HTTP Archive (.har) downloaded");
    } else if (kind === "svg") {
      downloadFile(`${base}-flowchart.svg`, toFlowchartSvg(result), "image/svg+xml");
      toast.success("Flowchart SVG downloaded");
    } else {
      downloadFile(`${base}.json`, toJson([result]), "application/json");
      toast.success("JSON downloaded");
    }
  }

  return (
    <div className="animate-reveal space-y-4">
      {/* Report header card */}
      <section className="panel space-y-4 p-4 shadow-elevated sm:p-6">
        <header className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.11em] text-muted-foreground">
              Analyzed URL
            </p>
            <div className="mt-1 flex items-start gap-2">
              <h2 className="min-w-0 break-all font-mono text-[13px] font-medium text-foreground">
                {result.startUrl}
              </h2>
              <CopyButton value={result.startUrl} label="Copy start URL" />
            </div>
            {analyzedAt ? (
              <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <CalendarClock className="size-3" />
                Analyzed {analyzedAt}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {result.userAgentLabel ? (
              <Badge
                variant="outline"
                className="border-hairline bg-surface-muted font-mono text-[10.5px] text-muted-foreground"
              >
                {result.userAgentLabel}
              </Badge>
            ) : null}
            <Badge
              variant="outline"
              className={
                result.source === "demo"
                  ? "border-warning/40 bg-warning/10 text-warning-foreground"
                  : "border-success/30 bg-success/10 text-success"
              }
            >
              {result.source === "demo" ? "Demo data" : "Live request"}
            </Badge>
            {shareId ? <ShareButton shareId={shareId} /> : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="subtle" size="sm">
                  <Download className="size-3.5" />
                  Download
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => download("seo-csv")}>
                  <FileCheck2 className="size-3.5 text-brand" />
                  SEO Audit (.csv)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => download("har")}>
                  <FileCode2 className="size-3.5 text-brand" />
                  HTTP Archive (.har)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => download("svg")}>
                  <FileCode2 className="size-3.5" />
                  Visual Flowchart (.svg)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => download("txt")}>
                  <FileText className="size-3.5" />
                  Report (.txt)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => download("json")}>
                  <FileJson className="size-3.5" />
                  Full data (.json)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {result.finalUrl && result.finalUrl !== result.startUrl ? (
          <div className="flex min-w-0 items-center justify-between gap-2 rounded-xl border border-hairline bg-surface/70 px-3 py-2 text-[11.5px] text-muted-foreground">
            <div className="flex min-w-0 items-start gap-1.5">
              <Link2 className="mt-0.5 size-3.5 shrink-0" />
              <span className="min-w-0">
                {result.finalDestinationConfirmed === false
                  ? "Last URL reached (not confirmed as the final destination): "
                  : "Final destination: "}
                <span className="break-all font-mono text-foreground">{result.finalUrl}</span>
              </span>
            </div>
            <CopyButton value={result.finalUrl} label="Copy final URL" />
          </div>
        ) : null}

        {result.seo.cleanFinalUrl && result.seo.cleanFinalUrl !== result.finalUrl ? (
          <div className="flex min-w-0 items-center justify-between gap-2 rounded-xl border border-brand/25 bg-brand/5 px-3 py-2 text-[11.5px] text-muted-foreground">
            <span className="min-w-0">
              Clean URL (tracking stripped):{" "}
              <span className="break-all font-mono text-foreground">
                {result.seo.cleanFinalUrl}
              </span>
            </span>
            <CopyButton value={result.seo.cleanFinalUrl} label="Copy clean URL" />
          </div>
        ) : null}

        {result.finalDestinationConfirmed === false && result.terminationDetail ? (
          <div className="space-y-3 rounded-xl border border-warning/35 bg-warning/10 px-3.5 py-3 text-[12px] text-warning-foreground">
            <div className="flex min-w-0 items-start gap-2">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0 flex-1 space-y-1">
                <p>
                  <span className="font-semibold">Trace stopped early — </span>
                  {result.terminationDetail}
                </p>
                {isUpstreamGate ? (
                  <p className="text-[11px] opacity-90">
                    The target host rejected our cloud server node&apos;s IP or device profile.
                    Retry with a mobile browser profile below, or open the blocked hop on your own
                    device network and paste the landed URL to continue tracing.
                  </p>
                ) : null}
              </div>
            </div>

            {isUpstreamGate && lastHop ? (
              <div className="space-y-2.5 border-t border-warning/25 pt-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  {onRetryTrace ? (
                    <>
                      <Button
                        type="button"
                        variant="subtle"
                        size="sm"
                        className="h-7 px-2.5 text-[11px]"
                        onClick={() => onRetryTrace(result.startUrl, "mobile-android")}
                      >
                        <Smartphone className="size-3" />
                        Retry as Android Chrome
                      </Button>
                      <Button
                        type="button"
                        variant="subtle"
                        size="sm"
                        className="h-7 px-2.5 text-[11px]"
                        onClick={() => onRetryTrace(result.startUrl, "mobile-iphone")}
                      >
                        <Smartphone className="size-3" />
                        Retry as iPhone iOS
                      </Button>
                    </>
                  ) : null}
                  {/^https?:\/\//i.test(lastHop.url) ? (
                    <Button asChild variant="outline" size="sm" className="h-7 px-2.5 text-[11px]">
                      <a href={lastHop.url} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="size-3" />
                        Open hop on your network
                      </a>
                    </Button>
                  ) : null}
                </div>

                {onRetryTrace ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const trimmed = continuationUrl.trim();
                      if (!trimmed) return;
                      onRetryTrace(trimmed, result.userAgentPreset ?? "mobile-android");
                      setContinuationUrl("");
                    }}
                    className="flex flex-col gap-2 sm:flex-row"
                  >
                    <Input
                      value={continuationUrl}
                      onChange={(e) => setContinuationUrl(e.target.value)}
                      placeholder="Paste final/next URL from your browser to continue tracing..."
                      aria-label="Paste destination URL to continue tracing"
                      className="h-8 flex-1 bg-background/90 font-mono text-[11.5px] text-foreground"
                    />
                    <Button
                      type="submit"
                      variant="default"
                      size="sm"
                      disabled={!continuationUrl.trim()}
                      className="h-8 shrink-0 px-3 text-[11.5px]"
                    >
                      Continue trace
                      <ArrowRight className="size-3" />
                    </Button>
                  </form>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {result.error ? (
          <p className="rounded-xl border border-destructive/30 bg-destructive/8 px-3 py-2.5 text-sm text-destructive">
            {result.error}
          </p>
        ) : null}

        <SummaryCards result={result} />
      </section>

      {/* Collapsible detail sections */}
      <Accordion
        type="multiple"
        defaultValue={["chain", "graph", "threat", "seo", "rules", "cloaking"]}
        className="space-y-3"
      >
        {SECTIONS.map((section, i) => (
          <AccordionItem
            key={section.value}
            value={section.value}
            className="panel animate-reveal overflow-hidden border-b-0 px-4 sm:px-5"
            style={{ animationDelay: `${120 + i * 60}ms` }}
          >
            <AccordionTrigger className="py-4 hover:no-underline">
              <span className="flex min-w-0 flex-col items-start gap-0.5 text-left">
                <span className="text-[13.5px] font-semibold tracking-tight text-foreground">
                  {section.label}
                </span>
                <span className="text-[11px] font-normal text-muted-foreground">
                  {section.description}
                </span>
              </span>
            </AccordionTrigger>
            <AccordionContent className="pb-5">
              {section.value === "chain" ? <ChainTab result={result} /> : null}
              {section.value === "graph" ? <VisualGraphTab result={result} /> : null}
              {section.value === "threat" ? <ThreatScannerTab result={result} /> : null}
              {section.value === "seo" ? <SeoTab result={result} /> : null}
              {section.value === "rules" ? <ServerRulesTab result={result} /> : null}
              {section.value === "cloaking" ? <CloakingMatrixPanel result={result} /> : null}
              {section.value === "tracking" ? <TrackingTab result={result} /> : null}
              {section.value === "headers" ? <HeadersTab result={result} /> : null}
              {section.value === "raw" ? <RawTab result={result} /> : null}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}
