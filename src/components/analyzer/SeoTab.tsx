import { Globe, Search, Share2 } from "lucide-react";
import type { CSSProperties } from "react";

import { gradeSeoAnalysis } from "@/lib/redirect-rules-codegen";
import { cn } from "@/lib/utils";
import type { RedirectAnalysis } from "@/lib/redirect-types";
import { CopyButton } from "./CopyButton";

function Row({
  label,
  value,
  tone,
  index,
  copyValue,
}: {
  label: string;
  value: string;
  tone?: "good" | "bad" | "warn";
  index: number;
  copyValue?: string;
}) {
  return (
    <div
      className="animate-rise stagger-fast flex flex-col gap-1 border-b border-hairline py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
      style={{ "--stagger": index } as CSSProperties}
    >
      <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
      <span
        className={cn(
          "flex min-w-0 items-center gap-2 break-all font-mono text-[13px] font-medium text-foreground sm:justify-end sm:text-right",
          tone === "good" && "text-success",
          tone === "bad" && "text-destructive",
          tone === "warn" && "text-warning-foreground",
        )}
      >
        <span>{value}</span>
        {copyValue ? <CopyButton value={copyValue} label={`Copy ${label}`} /> : null}
      </span>
    </div>
  );
}

export function SeoTab({ result }: { result: RedirectAnalysis }) {
  const { seo } = result;
  const audit = gradeSeoAnalysis(result);

  const canonicalStatusLabel =
    seo.canonicalStatus === "match"
      ? "Matches final URL (self-referencing)"
      : seo.canonicalStatus === "mismatch"
        ? "Points to a different URL"
        : "Not declared";
  const canonicalStatusTone =
    seo.canonicalStatus === "match"
      ? "good"
      : seo.canonicalStatus === "mismatch"
        ? "warn"
        : undefined;

  const displayUrl = seo.cleanFinalUrl || result.finalUrl;
  let hostLabel = displayUrl;
  try {
    hostLabel = new URL(displayUrl).hostname;
  } catch {
    /* keep raw */
  }

  const serpTitle = seo.title || seo.ogTitle || `${hostLabel} — Landing Page`;
  const serpDesc =
    seo.description ||
    seo.ogDescription ||
    'No <meta name="description"> tag detected on the final destination response.';
  const socialTitle = seo.ogTitle || seo.title || serpTitle;
  const socialDesc = seo.ogDescription || seo.description || serpDesc;

  return (
    <div className="space-y-4">
      {/* SEO Health Score Summary */}
      <div className="flex flex-col gap-3 rounded-xl border border-hairline bg-surface-muted/70 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
            <span>SEO Redirect &amp; Indexability Grade:</span>
            <span
              className={cn(
                "font-mono tabular-nums",
                audit.grade === "Pass" && "text-success",
                audit.grade === "Warning" && "text-warning-foreground",
                audit.grade === "Critical" && "text-destructive",
              )}
            >
              {audit.grade} ({audit.score}/100)
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{audit.notes.join(" · ")}</p>
        </div>
      </div>

      {/* Live Google SERP & Social Card Previews */}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-hairline bg-surface p-4">
          <p className="mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
            <Search className="size-3.5 text-brand" />
            Google SERP Snippet Preview
          </p>
          <div className="space-y-1">
            <p className="truncate font-mono text-[11px] text-muted-foreground">{displayUrl}</p>
            <p className="line-clamp-1 text-sm font-semibold text-info">{serpTitle}</p>
            <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{serpDesc}</p>
          </div>
        </div>

        <div className="rounded-xl border border-hairline bg-surface p-4">
          <p className="mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
            <Share2 className="size-3.5 text-brand" />
            OpenGraph / Social Card Preview
          </p>
          <div className="space-y-1">
            <p className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
              <Globe className="size-3 shrink-0" />
              <span className="truncate">{hostLabel}</span>
              {seo.twitterCard ? (
                <>
                  <span>·</span>
                  <span>{seo.twitterCard}</span>
                </>
              ) : null}
            </p>
            <p className="line-clamp-1 text-sm font-semibold text-foreground">{socialTitle}</p>
            <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {socialDesc}
            </p>
          </div>
        </div>
      </div>

      {/* Detailed SEO Signals Table */}
      <div className="panel px-4 py-1">
        <Row
          index={0}
          label="Final HTTP status"
          value={seo.finalStatus ? String(seo.finalStatus) : "—"}
          tone={seo.finalStatus && seo.finalStatus < 400 ? "good" : "bad"}
        />
        <Row
          index={1}
          label="HTTPS on final URL"
          value={seo.https ? "Secure (HTTPS)" : "Not secure (HTTP)"}
          tone={seo.https ? "good" : "bad"}
        />
        <Row
          index={2}
          label="HSTS (Strict-Transport-Security)"
          value={seo.hsts ? "Enabled" : "Not set"}
          tone={seo.hsts ? "good" : "warn"}
        />
        <Row
          index={3}
          label="Canonical URL"
          value={seo.canonical ?? "not found"}
          copyValue={seo.canonical ?? undefined}
        />
        <Row
          index={4}
          label="Canonical alignment"
          value={canonicalStatusLabel}
          tone={canonicalStatusTone}
        />
        <Row
          index={5}
          label="Meta robots"
          value={seo.metaRobots ?? "not found (indexable by default)"}
          tone={seo.metaRobots?.toLowerCase().includes("noindex") ? "bad" : "good"}
        />
        <Row
          index={6}
          label="X-Robots-Tag HTTP header"
          value={seo.xRobotsTag ?? "not set"}
          tone={seo.xRobotsTag?.toLowerCase().includes("noindex") ? "bad" : undefined}
        />
        <Row
          index={7}
          label="Destination <title>"
          value={seo.title ?? "not found"}
          tone={seo.title ? "good" : "warn"}
        />
        <Row
          index={8}
          label="Meta description"
          value={seo.description ?? "not found"}
          tone={seo.description ? "good" : "warn"}
        />
        <Row
          index={9}
          label="Hreflang alternates"
          value={seo.hreflangCount ? `${seo.hreflangCount} language tag(s)` : "none declared"}
        />
        <Row index={10} label="Cache-Control policy" value={seo.cacheControl ?? "not set"} />
        <Row
          index={11}
          label="Redirect chain length"
          value={String(seo.chainLength)}
          tone={seo.chainLength <= 1 ? "good" : seo.chainLength <= 2 ? "warn" : "bad"}
        />
        <Row
          index={12}
          label="Temporary redirects (302 / 307 / client)"
          value={String(seo.temporaryRedirectsCount ?? 0)}
          tone={(seo.temporaryRedirectsCount ?? 0) === 0 ? "good" : "warn"}
        />
        {result.userAgentLabel ? (
          <Row index={13} label="Simulated User-Agent" value={result.userAgentLabel} />
        ) : null}
        <Row index={14} label="Final URL" value={result.finalUrl} copyValue={result.finalUrl} />
        {seo.cleanFinalUrl && seo.cleanFinalUrl !== result.finalUrl ? (
          <Row
            index={15}
            label="Clean URL (tracking stripped)"
            value={seo.cleanFinalUrl}
            tone="good"
            copyValue={seo.cleanFinalUrl}
          />
        ) : null}
      </div>
    </div>
  );
}
