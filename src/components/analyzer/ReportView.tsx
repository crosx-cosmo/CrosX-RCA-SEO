import {
  CalendarClock,
  Download,
  FileCheck2,
  FileCode2,
  FileJson,
  FileText,
  Link2,
  TriangleAlert,
} from "lucide-react";
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
import { downloadFile, toJson, toReport, toSeoAuditCsv } from "@/lib/redirect-export";
import { toFlowchartSvg, toHar } from "@/lib/redirect-har";
import type { RedirectAnalysis } from "@/lib/redirect-types";
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
}: {
  result: RedirectAnalysis;
  shareId?: string | undefined;
}) {
  const analyzedAt = formatDate(result.analyzedAt);
  const base = `crosx-redirect-report-${slug(result.startUrl)}`;

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
          <p className="flex min-w-0 items-start gap-1.5 rounded-xl border border-warning/35 bg-warning/10 px-3 py-2.5 text-[12px] text-warning-foreground">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span className="min-w-0">
              <span className="font-semibold">Trace stopped early — </span>
              {result.terminationDetail}
            </span>
          </p>
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
