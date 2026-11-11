import {
  CheckCircle2,
  Globe,
  Radar,
  RotateCcw,
  SearchCheck,
  ServerCrash,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { CSSProperties } from "react";

import { Skeleton } from "@/components/ui/skeleton";

const SEO_AUDIT_LOADING_ROWS = [
  "Final HTTP status & protocol security",
  "HSTS (Strict-Transport-Security) policy",
  "Canonical URL & self-referencing alignment",
  "Meta robots & X-Robots-Tag directives",
  "Tracking parameter diff & clean URL extraction",
] as const;

export function LoadingState({
  urls,
  userAgentLabel,
}: {
  urls?: string[];
  userAgentLabel?: string;
} = {}) {
  const primaryUrl = urls?.[0];
  const extraCount = urls && urls.length > 1 ? urls.length - 1 : 0;

  return (
    <section
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Analyzing redirect chain and SEO signals"
      className="panel animate-reveal relative space-y-5 overflow-hidden p-4 sm:p-6"
    >
      {/* Top shimmer progress bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-1 overflow-hidden bg-brand/15">
        <div className="animate-shimmer h-full w-full bg-brand/40" />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="animate-pulse-ring grid size-8 shrink-0 place-items-center rounded-full bg-brand/12">
            <Radar className="size-4 animate-spin text-brand" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">
              Tracing redirect hops &amp; auditing SEO signals…
            </p>
            <p className="truncate font-mono text-xs text-muted-foreground">
              {primaryUrl
                ? `${primaryUrl}${extraCount > 0 ? ` (+${extraCount} more)` : ""}`
                : "Following server-side HTTP, meta-refresh & JavaScript hops"}
            </p>
          </div>
        </div>
        {userAgentLabel ? (
          <span className="animate-shimmer inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border border-hairline bg-surface-muted px-3 py-1 font-mono text-[11px] font-medium text-muted-foreground">
            <Globe className="size-3 text-brand" />
            {userAgentLabel}
          </span>
        ) : null}
      </div>

      {/* Active pipeline stages with animate-shimmer */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {[
          { icon: Radar, label: "1. Resolving HTTP & JS hops" },
          { icon: SearchCheck, label: "2. Auditing canonical & robots SEO" },
          { icon: ShieldCheck, label: "3. Inspecting HSTS & UTM parameters" },
        ].map(({ icon: Icon, label }, idx) => (
          <div
            key={label}
            className="animate-shimmer flex items-center gap-2 rounded-xl border border-hairline bg-surface-muted/80 px-3 py-2 text-xs font-medium text-foreground"
            style={{ "--stagger": idx } as CSSProperties}
          >
            <Icon className="size-3.5 shrink-0 text-brand" />
            <span className="truncate">{label}</span>
          </div>
        ))}
      </div>

      {/* Summary metric cards shimmer */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="animate-rise stagger-fast relative overflow-hidden rounded-xl border border-hairline bg-surface-muted p-4"
            style={{ "--stagger": i } as CSSProperties}
          >
            <Skeleton className="h-3 w-24 rounded-full" />
            <Skeleton className="mt-3 h-6 w-16 rounded-md" />
            <span className="animate-shimmer pointer-events-none absolute inset-0" />
          </div>
        ))}
      </div>

      {/* SEO Signals Audit Shimmer Panel */}
      <div className="relative overflow-hidden rounded-xl border border-hairline bg-surface-muted/60 p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            <CheckCircle2 className="size-3.5 text-brand" />
            SEO Signals &amp; Indexability Audit
          </span>
          <Skeleton className="h-4 w-24 rounded-full" />
        </div>
        <div className="divide-y divide-hairline">
          {SEO_AUDIT_LOADING_ROWS.map((rowLabel, i) => (
            <div
              key={rowLabel}
              className="flex items-center justify-between gap-4 py-2.5 first:pt-1 last:pb-1"
            >
              <span className="text-xs text-muted-foreground">{rowLabel}</span>
              <Skeleton className="h-4 w-28 rounded-md sm:w-40" />
            </div>
          ))}
        </div>
        <span className="animate-shimmer pointer-events-none absolute inset-0" />
      </div>

      {/* Hop cards shimmer */}
      <div className="space-y-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <div
            key={i}
            className="animate-rise stagger relative h-24 overflow-hidden rounded-xl border border-hairline bg-surface-muted p-4"
            style={{ "--stagger": i } as CSSProperties}
          >
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-4 w-16 rounded-md" />
            </div>
            <Skeleton className="mt-3 h-4 w-3/4 rounded-md" />
            <span className="animate-shimmer pointer-events-none absolute inset-0" />
          </div>
        ))}
      </div>
    </section>
  );
}

export function EmptyState() {
  return (
    <section className="animate-reveal relative overflow-hidden rounded-2xl border border-dashed border-hairline bg-surface/70 p-8 text-center">
      <div className="relative">
        <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-brand-gradient shadow-glow">
          <Radar className="size-6 text-brand-foreground" />
        </div>
        <h2 className="mt-4 text-base font-semibold text-foreground">No analysis yet</h2>
        <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">
          Paste a URL above to trace every hop, status code, timing and tracking parameter in the
          redirect chain — or load demo data to explore the interface.
        </p>
        <p className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-3 py-1 text-[11px] font-medium text-muted-foreground">
          <Sparkles className="size-3 text-brand" />
          Real requests run server-side
        </p>
      </div>
    </section>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <section className="animate-reveal rounded-2xl border border-destructive/30 bg-destructive/8 p-6 text-center">
      <div className="mx-auto grid size-11 place-items-center rounded-xl border border-destructive/25 bg-destructive/10">
        <ServerCrash className="size-5 text-destructive" />
      </div>
      <h2 className="mt-3 text-base font-semibold text-destructive">Analysis failed</h2>
      <p className="mx-auto mt-1.5 max-w-md break-words text-sm text-destructive/85">{message}</p>
      <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-medium text-destructive/70">
        <RotateCcw className="size-3" />
        Check the URL and try again
      </p>
    </section>
  );
}
