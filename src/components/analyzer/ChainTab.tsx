import {
  ChevronRight,
  Clock,
  CodeXml,
  Cookie,
  CornerDownRight,
  Eye,
  FileCode2,
  Flag,
  Globe,
  KeyRound,
  Lock,
  MapPin,
  MonitorPlay,
  RefreshCw,
  Server,
  ShieldAlert,
  Unlock,
} from "lucide-react";
import type { CSSProperties } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { SLOW_HOP_MS, isRedirect } from "@/lib/redirect-analysis";
import type { HopMechanism, RedirectAnalysis, RedirectHop } from "@/lib/redirect-types";
import { CopyButton } from "./CopyButton";
import { StatusBadge, statusTone } from "./StatusBadge";
import { IssueList } from "./IssueList";

function mechanismTone(mechanism: HopMechanism | undefined): string {
  switch (mechanism) {
    case "javascript-redirect":
    case "form-redirect":
      return "border-info/30 bg-info/10 text-info";
    case "gateway-unwrap":
      return "border-brand/35 bg-brand/10 text-brand";
    case "meta-refresh":
      return "border-warning/35 bg-warning/10 text-warning-foreground";
    case "browser-navigation":
      return "border-brand/35 bg-brand/10 text-brand";
    case "final-response":
      return "border-success/30 bg-success/10 text-success";
    case "blocked":
    case "unresolved":
    case "error":
      return "border-destructive/30 bg-destructive/10 text-destructive";
    default:
      return "border-hairline bg-surface-muted text-muted-foreground";
  }
}

function mechanismIcon(mechanism: HopMechanism | undefined) {
  const className = "size-3";
  switch (mechanism) {
    case "javascript-redirect":
      return <CodeXml className={className} />;
    case "form-redirect":
      return <FileCode2 className={className} />;
    case "gateway-unwrap":
      return <KeyRound className={className} />;
    case "meta-refresh":
      return <RefreshCw className={className} />;
    case "browser-navigation":
      return <MonitorPlay className={className} />;
    case "final-response":
      return <Flag className={className} />;
    case "blocked":
    case "unresolved":
    case "error":
      return <ShieldAlert className={className} />;
    default:
      return <CornerDownRight className={className} />;
  }
}

const dotTone: Record<string, string> = {
  success: "bg-success",
  info: "bg-info",
  warning: "bg-warning",
  error: "bg-destructive",
  neutral: "bg-muted-foreground",
};

const ringTone: Record<string, string> = {
  success: "border-success/40",
  info: "border-info/40",
  warning: "border-warning/45",
  error: "border-destructive/40",
  neutral: "border-hairline",
};

function FlowStrip({ result }: { result: RedirectAnalysis }) {
  let host = result.startUrl;
  try {
    host = new URL(result.startUrl).host;
  } catch {
    /* keep raw value when the URL cannot be parsed */
  }

  return (
    <div className="panel overflow-x-auto p-3">
      <div className="flex min-w-max items-center gap-2">
        <span className="animate-rise stagger max-w-[180px] truncate rounded-md border border-hairline bg-surface px-2 py-1 font-mono text-[11px] text-muted-foreground sm:max-w-[260px]">
          {host}
        </span>
        {result.hops.map((hop, i) => (
          <span key={hop.index} className="flex items-center gap-2">
            <ChevronRight
              className="animate-fade stagger size-3.5 text-muted-foreground/70"
              style={{ "--stagger": i * 2 + 1 } as CSSProperties}
            />
            <span
              className="animate-node stagger inline-flex"
              style={{ "--stagger": i * 2 + 2 } as CSSProperties}
            >
              <StatusBadge status={hop.status} label={hop.status === 200 ? "OK" : undefined} />
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Meta({
  icon: Icon,
  label,
  value,
  mono = true,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        <Icon className="size-3 shrink-0" />
        <span className="truncate">{label}</span>
      </p>
      <p
        className={cn("mt-0.5 truncate text-xs text-foreground", mono && "font-mono tabular-nums")}
        title={value}
      >
        {value}
      </p>
    </div>
  );
}

function LatencyWaterfall({ result }: { result: RedirectAnalysis }) {
  const total = Math.max(1, result.totalResponseTimeMs);
  if (result.hops.length <= 1 || result.totalResponseTimeMs <= 0) return null;

  let cumulative = 0;
  return (
    <div className="panel space-y-2.5 p-3.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-foreground">Latency Waterfall Timeline</span>
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          Total: {result.totalResponseTimeMs} ms across {result.hops.length} hops
        </span>
      </div>
      <div className="space-y-1.5">
        {result.hops.map((hop) => {
          const startPct = Math.min(96, Math.round((cumulative / total) * 100));
          const widthPct = Math.max(
            4,
            Math.min(100 - startPct, Math.round((hop.responseTimeMs / total) * 100)),
          );
          cumulative += hop.responseTimeMs;
          const slow = hop.responseTimeMs > SLOW_HOP_MS;
          return (
            <div key={hop.index} className="grid grid-cols-12 items-center gap-2 text-[11px]">
              <span className="col-span-3 truncate font-mono text-muted-foreground sm:col-span-2">
                Hop {hop.index + 1} ({hop.status || "—"})
              </span>
              <div className="relative col-span-6 h-2 overflow-hidden rounded-full bg-surface-muted sm:col-span-8">
                <div
                  className={cn(
                    "absolute top-0 h-full rounded-full",
                    slow
                      ? "bg-warning"
                      : hop.status >= 300 && hop.status < 400
                        ? "bg-brand"
                        : "bg-success",
                  )}
                  style={{ left: `${startPct}%`, width: `${widthPct}%` }}
                />
              </div>
              <span className="col-span-3 text-right font-mono tabular-nums text-foreground sm:col-span-2">
                {hop.responseTimeMs} ms
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ChainTab({ result }: { result: RedirectAnalysis }) {
  return (
    <div className="space-y-5">
      <FlowStrip result={result} />
      <LatencyWaterfall result={result} />

      <ol className="relative space-y-3 pl-7 sm:pl-9">
        {/* connecting rail */}
        <span
          className="animate-draw pointer-events-none absolute bottom-4 left-[10px] top-4 w-px origin-top bg-gradient-to-b from-brand/50 via-hairline to-transparent sm:left-[14px]"
          aria-hidden
        />
        {result.hops.map((hop, i) => {
          const tone = statusTone(hop.status);
          const slow = hop.responseTimeMs > SLOW_HOP_MS;
          return (
            <li
              key={hop.index}
              className="animate-rise stagger relative"
              style={{ "--stagger": i * 2 } as CSSProperties}
            >
              <span
                className={cn(
                  "animate-node stagger absolute -left-7 top-5 grid size-5 place-items-center rounded-full border bg-background sm:-left-9",
                  ringTone[tone],
                )}
                style={{ "--stagger": i * 2 + 1 } as CSSProperties}
                aria-hidden
              >
                <span className={cn("size-2 rounded-full", dotTone[tone])} />
              </span>

              <div className="panel panel-hover p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="font-mono text-[10px] tabular-nums">
                    HOP {hop.index + 1}
                  </Badge>
                  {hop.status ? <StatusBadge status={hop.status} /> : null}
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold",
                      mechanismTone(hop.mechanism),
                    )}
                  >
                    {mechanismIcon(hop.mechanism)}
                    {hop.mechanismLabel ?? hop.redirectType}
                  </span>
                  {hop.mechanismDetail ? (
                    <span className="text-[11px] font-medium text-muted-foreground">
                      {hop.mechanismDetail}
                    </span>
                  ) : (
                    <span className="text-[11px] font-medium text-muted-foreground">
                      {hop.redirectType}
                    </span>
                  )}
                  {hop.protocol === "https" ? (
                    <span className="ml-auto inline-flex items-center gap-1 rounded-md border border-success/25 bg-success/10 px-1.5 py-0.5 text-[10px] font-semibold text-success">
                      <Lock className="size-3" /> HTTPS
                    </span>
                  ) : (
                    <span className="ml-auto inline-flex items-center gap-1 rounded-md border border-destructive/25 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
                      <Unlock className="size-3" /> HTTP
                    </span>
                  )}
                </div>

                <div className="mt-3 flex items-start gap-2">
                  <p className="min-w-0 break-all font-mono text-xs leading-relaxed text-foreground">
                    {hop.url}
                  </p>
                  <CopyButton value={hop.url} label="Copy URL" />
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3 border-t border-hairline pt-3 sm:grid-cols-4">
                  <Meta
                    icon={Clock}
                    label="Response"
                    value={`${hop.responseTimeMs} ms${slow ? " · slow" : ""}`}
                  />
                  <Meta icon={Globe} label="Protocol" value={hop.protocol.toUpperCase()} />
                  <Meta icon={Server} label="Server" value={hop.server ?? "not exposed"} />
                  <Meta icon={MapPin} label="Node / IP" value={hop.ip ?? "not exposed"} />
                </div>

                {result.totalResponseTimeMs > 0 ? (
                  <div className="mt-2.5 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          slow ? "bg-warning" : "bg-brand/75",
                        )}
                        style={{
                          width: `${Math.min(
                            100,
                            Math.max(
                              4,
                              Math.round(
                                (hop.responseTimeMs / Math.max(1, result.totalResponseTimeMs)) *
                                  100,
                              ),
                            ),
                          )}%`,
                        }}
                      />
                    </div>
                    <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                      {Math.round(
                        (hop.responseTimeMs / Math.max(1, result.totalResponseTimeMs)) * 100,
                      )}
                      % of total latency
                    </span>
                  </div>
                ) : null}

                {hop.nextUrl ? (
                  <div className="mt-3 rounded-lg border border-hairline bg-surface-muted px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                      {hop.mechanism === "http-redirect"
                        ? "Location header → destination"
                        : "Detected destination"}
                    </p>
                    <p className="mt-0.5 break-all font-mono text-xs text-foreground">
                      {hop.nextUrl}
                    </p>
                    {hop.evidence ? (
                      <p className="mt-1 break-all font-mono text-[10.5px] text-muted-foreground">
                        {hop.evidence}
                      </p>
                    ) : null}
                  </div>
                ) : isRedirect(hop.status) ? (
                  <div className="mt-3 rounded-lg border border-hairline bg-surface-muted px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                      Location header
                    </p>
                    <p className="mt-0.5 break-all font-mono text-xs text-destructive">
                      {hop.location ?? "missing — broken redirect"}
                    </p>
                  </div>
                ) : null}

                {hop.blockedReason ? (
                  <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-warning/35 bg-warning/10 px-3 py-2 text-[11.5px] text-warning-foreground">
                    <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
                    <span className="min-w-0">{hop.blockedReason}</span>
                  </p>
                ) : null}

                <HopForensicsPanel hop={hop} />
              </div>
            </li>
          );
        })}
      </ol>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-foreground">Detected findings</h3>
        <IssueList issues={result.issues} />
      </div>
    </div>
  );
}

function HopForensicsPanel({ hop }: { hop: RedirectHop }) {
  const f = hop.forensics;
  if (!f) return null;

  const hasSteps = Boolean(f.deobfuscationSteps && f.deobfuscationSteps.length > 0);
  const hasCookiesSet = Boolean(f.cookiesSet && f.cookiesSet.length > 0);
  const hasCookiesSent = Boolean(f.cookiesSent && f.cookiesSent.length > 0);
  const hasReferer = Boolean(f.refererSent);
  const hasEmbedded = Boolean(f.embeddedTargets && f.embeddedTargets.length > 0);
  const hasArtifacts = Boolean(f.hiddenArtifacts && f.hiddenArtifacts.length > 0);

  if (
    !hasSteps &&
    !hasCookiesSet &&
    !hasCookiesSent &&
    !hasReferer &&
    !hasEmbedded &&
    !hasArtifacts
  ) {
    return null;
  }

  return (
    <div className="mt-3 space-y-2.5 rounded-xl border border-hairline bg-surface-muted/60 p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-foreground">
          <Eye className="size-3.5 text-brand" />
          Deep Hop Forensics &amp; De-Obfuscation
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {hasCookiesSet ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-hairline bg-background px-1.5 py-0.5 font-mono text-[10px] text-foreground">
              <Cookie className="size-3 text-brand" />
              Set-Cookie ({f.cookiesSet!.length})
            </span>
          ) : null}
          {hasCookiesSent ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-hairline bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              Cookie Jar → {f.cookiesSent!.join(", ")}
            </span>
          ) : null}
          {hasReferer ? (
            <span
              className="max-w-[240px] truncate rounded-md border border-hairline bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
              title={`Referer: ${f.refererSent}`}
            >
              Referer: {f.refererSent}
            </span>
          ) : null}
        </div>
      </div>

      {hasSteps ? (
        <div className="space-y-1 rounded-lg border border-brand/25 bg-brand/5 px-2.5 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-brand">
            De-Obfuscation &amp; Unwrap Trail
          </p>
          <ul className="list-disc space-y-0.5 pl-4 font-mono text-[11px] text-foreground">
            {f.deobfuscationSteps!.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {hasEmbedded ? (
        <div className="space-y-1 rounded-lg border border-hairline bg-background px-2.5 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Embedded / Encoded Target URL(s) in Request
          </p>
          <div className="space-y-1">
            {f.embeddedTargets!.map((t) => (
              <div key={`${t.source}-${t.url}`} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="mr-1.5 rounded bg-surface-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold text-brand">
                    {t.source}
                  </span>
                  <span className="break-all font-mono text-[11px] text-foreground">{t.url}</span>
                </div>
                <CopyButton value={t.url} label="Copy unwrapped target URL" />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {hasCookiesSet ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {f.cookiesSet!.map((c) => (
            <span
              key={c.name}
              className="inline-flex items-center gap-1 rounded-md border border-hairline bg-background px-2 py-0.5 font-mono text-[10.5px] text-foreground"
            >
              <strong className="font-semibold text-brand">{c.name}</strong>={c.valuePreview}
              {c.flags.length > 0 ? (
                <span className="text-[9.5px] text-muted-foreground">({c.flags.join(", ")})</span>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}

      {hasArtifacts ? (
        <div className="space-y-1 rounded-lg border border-hairline bg-background px-2.5 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Discovered Hidden Page Links &amp; Artifacts ({f.hiddenArtifacts!.length})
          </p>
          <div className="space-y-1">
            {f.hiddenArtifacts!.slice(0, 5).map((art) => (
              <div
                key={`${art.kind}-${art.url}`}
                className="flex items-center justify-between gap-2"
              >
                <div className="min-w-0 truncate">
                  <span className="mr-1.5 rounded bg-surface-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {art.label}
                  </span>
                  <span className="font-mono text-[11px] text-foreground">{art.url}</span>
                </div>
                <CopyButton value={art.url} label="Copy artifact URL" />
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
