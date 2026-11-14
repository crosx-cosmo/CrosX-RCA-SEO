import { gradeSeoAnalysis } from "./redirect-rules-codegen";
import type { RedirectAnalysis } from "./redirect-types";

export function toJson(results: RedirectAnalysis[]): string {
  return JSON.stringify(results.length === 1 ? results[0] : results, null, 2);
}

export function sanitizeCsvFormula(raw: string): string {
  if (!raw) return "";
  // Prevent CSV Formula / DDE Injection (=, +, -, @, tab, CR) unless it is a plain negative number
  if (/^[=+\-@\t\r]/.test(raw) && !/^-\d+(\.\d+)?$/.test(raw)) {
    return `'${raw}`;
  }
  return raw;
}

export function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : sanitizeCsvFormula(String(value));
  return `"${s.replace(/"/g, '""')}"`;
}

export function toSeoAuditCsv(results: RedirectAnalysis[]): string {
  const header = [
    "seo_grade",
    "seo_score",
    "start_url",
    "final_url",
    "clean_final_url",
    "final_status",
    "total_redirects",
    "temporary_redirects",
    "total_latency_ms",
    "https",
    "hsts",
    "canonical_status",
    "canonical_url",
    "meta_robots",
    "page_title",
    "lost_tracking_params",
    "audit_notes",
  ];
  const rows = results.map((r) => {
    const audit = gradeSeoAnalysis(r);
    return [
      audit.grade,
      audit.score,
      r.startUrl,
      r.finalUrl,
      r.seo.cleanFinalUrl ?? r.finalUrl,
      r.finalStatus ?? "",
      r.totalRedirects,
      r.seo.temporaryRedirectsCount ?? 0,
      r.totalResponseTimeMs,
      r.seo.https ? "Yes" : "No",
      r.seo.hsts ? "Yes" : "No",
      r.seo.canonicalStatus ?? "missing",
      r.seo.canonical ?? "",
      r.seo.metaRobots ?? "",
      r.seo.title ?? "",
      r.tracking.lostTrackingParams.join("; "),
      audit.notes.join("; "),
    ]
      .map(csvCell)
      .join(",");
  });
  return [header.map(csvCell).join(","), ...rows].join("\n");
}

export function toCsv(results: RedirectAnalysis[]): string {
  const header = [
    "start_url",
    "hop",
    "url",
    "protocol",
    "status",
    "status_text",
    "mechanism",
    "mechanism_detail",
    "redirect_type",
    "response_time_ms",
    "next_url",
    "blocked_reason",
    "location",
    "server",
    "ip",
  ];
  const rows = results.flatMap((result) =>
    result.hops.map((hop) =>
      [
        result.startUrl,
        hop.index + 1,
        hop.url,
        hop.protocol,
        hop.status,
        hop.statusText,
        hop.mechanismLabel ?? "",
        hop.mechanismDetail ?? "",
        hop.redirectType,
        hop.responseTimeMs,
        hop.nextUrl ?? "",
        hop.blockedReason ?? "",
        hop.location ?? "",
        hop.server ?? "",
        hop.ip ?? "",
      ]
        .map(csvCell)
        .join(","),
    ),
  );
  return [header.map(csvCell).join(","), ...rows].join("\n");
}

export function toReport(results: RedirectAnalysis[]): string {
  return results
    .map((result) => {
      const flow = result.hops
        .map((hop, i) => (i === 0 ? `${hop.url} → ${hop.status}` : `${hop.status}`))
        .join(" → ");
      const lines = [
        `Redirect Chain Report — ${result.startUrl}`,
        `Analyzed: ${result.analyzedAt} (${result.source} data)`,
        "",
        `Flow: ${flow}`,
        `Total hops: ${result.totalHops}`,
        `Total redirects: ${result.totalRedirects}`,
        `Total response time: ${result.totalResponseTimeMs} ms`,
        `Final status: ${result.finalStatus ?? "n/a"}`,
        `Final URL: ${result.finalUrl}`,
        `Redirect loop: ${result.redirectLoop ? "Yes" : "No"}`,
        `Final destination confirmed: ${result.finalDestinationConfirmed === false ? "No" : "Yes"}`,
        `Trace ended: ${result.terminationReason ?? "final-response"}${result.terminationDetail ? ` — ${result.terminationDetail}` : ""}`,
        "",
        "Hops:",
        ...result.hops.map(
          (hop) =>
            `  ${hop.index + 1}. [${hop.status || "—"} ${hop.mechanismLabel ?? hop.redirectType}] ${hop.url} (${hop.responseTimeMs} ms, ${hop.protocol.toUpperCase()}${hop.server ? `, ${hop.server}` : ""})` +
            (hop.mechanismDetail ? `\n     Mechanism: ${hop.mechanismDetail}` : "") +
            ((hop.nextUrl ?? hop.location)
              ? `\n     Destination: ${hop.nextUrl ?? hop.location}`
              : "") +
            (hop.blockedReason ? `\n     Not followed: ${hop.blockedReason}` : ""),
        ),
        "",
        "SEO:",
        `  Final status: ${result.seo.finalStatus ?? "n/a"}`,
        `  HTTPS: ${result.seo.https ? "Yes" : "No"}`,
        `  Canonical: ${result.seo.canonical ?? "not found"}`,
        `  Meta robots: ${result.seo.metaRobots ?? "not found"}`,
        `  Chain length: ${result.seo.chainLength}`,
        "",
        "Findings:",
        ...(result.issues.length
          ? result.issues.map(
              (issue) => `  [${issue.level.toUpperCase()}] ${issue.title} — ${issue.detail}`,
            )
          : ["  None"]),
        "",
        "Tracking:",
        `  Lost tracking params: ${result.tracking.lostTrackingParams.join(", ") || "none"}`,
        `  Kept tracking params: ${result.tracking.keptTrackingParams.join(", ") || "none"}`,
      ];
      return lines.join("\n");
    })
    .join("\n\n----------------------------------------\n\n");
}

export function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
