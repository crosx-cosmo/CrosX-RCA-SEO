import {
  AlertTriangle,
  CheckCircle2,
  Globe,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useMemo } from "react";

import type { RedirectAnalysis } from "@/lib/redirect-types";
import { scanRedirectThreats } from "@/lib/threat-scanner";

export function ThreatScannerTab({ result }: { result: RedirectAnalysis }) {
  const report = useMemo(() => scanRedirectThreats(result), [result]);

  const scoreColor =
    report.trustScore >= 85
      ? "text-success"
      : report.trustScore >= 65
        ? "text-warning"
        : "text-destructive";

  return (
    <div className="space-y-4">
      {/* Summary Score Banner */}
      <div className="grid gap-3 rounded-xl border border-hairline bg-surface/70 p-4 sm:grid-cols-3">
        <div className="flex items-center gap-3">
          {report.riskLevel === "clean" ? (
            <ShieldCheck className="size-8 shrink-0 text-success" />
          ) : (
            <ShieldAlert
              className={`size-8 shrink-0 ${
                report.riskLevel === "caution" ? "text-warning" : "text-destructive"
              }`}
            />
          )}
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
              Threat &amp; Trust Score
            </p>
            <div className="flex items-baseline gap-2">
              <span className={`font-mono text-2xl font-bold tabular-nums ${scoreColor}`}>
                {report.trustScore}/100
              </span>
              <span className="text-xs font-semibold text-foreground">{report.riskLabel}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col justify-center border-t border-hairline pt-2 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
            Domains Traversed
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 font-mono text-xs font-semibold text-foreground">
            <Globe className="size-3.5 text-brand" />
            {report.uniqueDomains.length} unique host{report.uniqueDomains.length === 1 ? "" : "s"}{" "}
            · {report.crossDomainHops} cross-domain hop{report.crossDomainHops === 1 ? "" : "s"}
          </p>
          <p className="truncate font-mono text-[11px] text-muted-foreground">
            {report.uniqueDomains.join(" → ")}
          </p>
        </div>

        <div className="flex flex-col justify-center border-t border-hairline pt-2 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
            Security Signals
          </p>
          <p className="mt-0.5 font-mono text-xs font-semibold text-foreground">
            {report.findings.length} threat finding{report.findings.length === 1 ? "" : "s"} ·{" "}
            {report.securityHeaders.filter((h) => h.present).length}/{report.securityHeaders.length}{" "}
            hardening headers
          </p>
          <p className="text-[11px] text-muted-foreground">
            Homograph, brand spoof, open-redirect &amp; TLD audit
          </p>
        </div>
      </div>

      {/* Threat Findings */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Phishing, Malware &amp; Redirect Threat Findings
        </h4>
        {report.findings.length === 0 ? (
          <div className="flex items-center gap-2.5 rounded-xl border border-success/30 bg-success/5 p-3.5 text-xs text-foreground">
            <CheckCircle2 className="size-4 shrink-0 text-success" />
            <span>
              No Punycode homographs, brand lookalikes, high-abuse TLDs, raw IP hosts, or
              open-redirect vulnerabilities were detected across this chain.
            </span>
          </div>
        ) : (
          <div className="space-y-2">
            {report.findings.map((finding) => (
              <div
                key={finding.id}
                className={`rounded-xl border p-3.5 ${
                  finding.severity === "critical" || finding.severity === "high"
                    ? "border-destructive/35 bg-destructive/5"
                    : "border-warning/35 bg-warning/5"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle
                      className={`size-4 shrink-0 ${
                        finding.severity === "critical" || finding.severity === "high"
                          ? "text-destructive"
                          : "text-warning"
                      }`}
                    />
                    <span className="text-xs font-semibold text-foreground">{finding.title}</span>
                  </div>
                  <span className="font-mono text-[10.5px] uppercase text-muted-foreground">
                    {finding.severity} ·{" "}
                    {finding.hopIndex !== null ? `Hop #${finding.hopIndex + 1}` : "Chain"}
                  </span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  {finding.detail}
                </p>
                <p className="mt-1 font-mono text-[11px] text-foreground">
                  Remediation: {finding.remediation}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Landing Page HTTP Security Headers Audit */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Destination Security Header Posture
        </h4>
        <div className="divide-y divide-hairline rounded-xl border border-hairline bg-surface/60">
          {report.securityHeaders.map((item) => (
            <div
              key={item.header}
              className="flex flex-col gap-1 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {item.present ? (
                    <CheckCircle2 className="size-3.5 shrink-0 text-success" />
                  ) : (
                    <XCircle className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="font-mono text-xs font-semibold text-foreground">
                    {item.header}
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    · {item.present ? "Present" : "Missing"}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {item.value ? (
                    <span className="break-all font-mono text-foreground">{item.value}</span>
                  ) : (
                    item.recommendation
                  )}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
