/**
 * Scheduled Redirect Drift & Uptime Monitor.
 *
 * Compares a live `RedirectAnalysis` against a saved baseline to detect:
 *  - Final destination URL drift (`final_url_changed`)
 *  - Newly injected intermediate redirect hops (`hops_increased`)
 *  - HTTP status code degradation (`status_degraded`)
 *  - Stripped UTM / affiliate tracking parameters (`tracking_dropped`)
 *  - Latency spikes (`latency_spike`)
 */

import type { RedirectAnalysis, UserAgentPreset } from "./redirect-types";

export interface MonitoredRedirectBaseline {
  id: string;
  label: string;
  startUrl: string;
  userAgentPreset: UserAgentPreset;
  expectedFinalUrl: string;
  expectedCleanFinalUrl: string;
  expectedStatus: number | null;
  expectedRedirects: number;
  expectedKeptParams: string[];
  baselineLatencyMs: number;
  intervalMinutes: 15 | 60 | 360 | 1440;
  webhookUrl?: string;
  createdAt: string;
  lastCheckedAt: string | null;
  lastStatus: "healthy" | "drifted" | "error" | "unchecked";
  lastDriftSummary: string | null;
}

export interface RedirectDriftAnomaly {
  kind:
    | "final_url_changed"
    | "hops_increased"
    | "status_degraded"
    | "tracking_dropped"
    | "latency_spike";
  severity: "warning" | "critical";
  title: string;
  expected: string;
  actual: string;
}

export interface RedirectDriftVerdict {
  status: "healthy" | "drifted" | "error";
  summary: string;
  anomalies: RedirectDriftAnomaly[];
  checkedAt: string;
}

export function createBaselineFromAnalysis(
  analysis: RedirectAnalysis,
  options?: {
    label?: string;
    intervalMinutes?: 15 | 60 | 360 | 1440;
    webhookUrl?: string;
  },
): MonitoredRedirectBaseline {
  return {
    id: `mon_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    label: options?.label?.trim() || analysis.startUrl,
    startUrl: analysis.startUrl,
    userAgentPreset: analysis.userAgentPreset ?? "desktop-chrome",
    expectedFinalUrl: analysis.finalUrl,
    expectedCleanFinalUrl: analysis.seo.cleanFinalUrl ?? analysis.finalUrl,
    expectedStatus: analysis.finalStatus,
    expectedRedirects: analysis.totalRedirects,
    expectedKeptParams: [...analysis.tracking.keptTrackingParams],
    baselineLatencyMs: analysis.totalResponseTimeMs,
    intervalMinutes: options?.intervalMinutes ?? 60,
    ...(options?.webhookUrl?.trim() ? { webhookUrl: options.webhookUrl.trim() } : {}),
    createdAt: new Date().toISOString(),
    lastCheckedAt: analysis.analyzedAt || new Date().toISOString(),
    lastStatus: "healthy",
    lastDriftSummary: "Baseline captured — 0 anomalies",
  };
}

export function evaluateRedirectDrift(
  baseline: MonitoredRedirectBaseline,
  live: RedirectAnalysis,
): RedirectDriftVerdict {
  const checkedAt = new Date().toISOString();

  if (live.error) {
    return {
      status: "error",
      summary: `Trace error: ${live.error}`,
      anomalies: [
        {
          kind: "status_degraded",
          severity: "critical",
          title: "Endpoint unreachable or trace failed",
          expected: String(baseline.expectedStatus ?? 200),
          actual: live.error,
        },
      ],
      checkedAt,
    };
  }

  const anomalies: RedirectDriftAnomaly[] = [];

  // 1. Compare clean final URL (or raw final URL)
  const liveClean = live.seo.cleanFinalUrl ?? live.finalUrl;
  if (liveClean !== baseline.expectedCleanFinalUrl && live.finalUrl !== baseline.expectedFinalUrl) {
    anomalies.push({
      kind: "final_url_changed",
      severity: "critical",
      title: "Final destination URL drifted",
      expected: baseline.expectedFinalUrl,
      actual: live.finalUrl,
    });
  }

  // 2. Compare HTTP status code
  if (
    baseline.expectedStatus !== live.finalStatus &&
    (live.finalStatus === null || live.finalStatus >= 400 || baseline.expectedStatus === 200)
  ) {
    anomalies.push({
      kind: "status_degraded",
      severity: live.finalStatus && live.finalStatus >= 400 ? "critical" : "warning",
      title: "Final HTTP status code changed",
      expected: String(baseline.expectedStatus ?? 200),
      actual: String(live.finalStatus ?? "ERR"),
    });
  }

  // 3. Compare redirect hop count
  if (live.totalRedirects > baseline.expectedRedirects) {
    anomalies.push({
      kind: "hops_increased",
      severity: live.totalRedirects - baseline.expectedRedirects >= 2 ? "critical" : "warning",
      title: `Redirect chain gained +${live.totalRedirects - baseline.expectedRedirects} extra hop(s)`,
      expected: `${baseline.expectedRedirects} redirect(s)`,
      actual: `${live.totalRedirects} redirect(s)`,
    });
  }

  // 4. Check if previously kept tracking params were dropped
  const newlyDropped = baseline.expectedKeptParams.filter(
    (param) => !live.tracking.keptTrackingParams.includes(param),
  );
  if (newlyDropped.length > 0) {
    anomalies.push({
      kind: "tracking_dropped",
      severity: "critical",
      title: `Tracking parameter(s) stripped: ${newlyDropped.join(", ")}`,
      expected: baseline.expectedKeptParams.join(", "),
      actual: live.tracking.keptTrackingParams.join(", ") || "none",
    });
  }

  // 5. Check for major latency regression (>3x baseline and >1500ms)
  if (
    live.totalResponseTimeMs > 1500 &&
    baseline.baselineLatencyMs > 0 &&
    live.totalResponseTimeMs > baseline.baselineLatencyMs * 3
  ) {
    anomalies.push({
      kind: "latency_spike",
      severity: "warning",
      title: "Redirect chain latency spike detected",
      expected: `${baseline.baselineLatencyMs} ms`,
      actual: `${live.totalResponseTimeMs} ms`,
    });
  }

  if (anomalies.length === 0) {
    return {
      status: "healthy",
      summary: `Healthy · ${live.totalRedirects} hop(s) · ${live.finalStatus ?? 200} OK (${live.totalResponseTimeMs} ms)`,
      anomalies: [],
      checkedAt,
    };
  }

  return {
    status: "drifted",
    summary: `${anomalies.length} drift anomaly${anomalies.length === 1 ? "" : "ies"}: ${anomalies.map((a) => a.title).join("; ")}`,
    anomalies,
    checkedAt,
  };
}

export function formatWebhookPayload(
  baseline: MonitoredRedirectBaseline,
  verdict: RedirectDriftVerdict,
  live: RedirectAnalysis,
) {
  const emoji = verdict.status === "healthy" ? "✅" : "🚨";
  const text = `${emoji} **[CROSX Redirect Monitor]** ${baseline.label}\n• **Start URL**: ${baseline.startUrl}\n• **Status**: ${verdict.status.toUpperCase()} — ${verdict.summary}\n• **Final URL**: ${live.finalUrl} (expected: ${baseline.expectedFinalUrl})\n• **Hops**: ${live.totalRedirects} (expected: ${baseline.expectedRedirects})`;

  return {
    // Compatible with Slack (`text`), Discord (`content`), and generic JSON webhooks (`event`, `monitor`, `verdict`)
    text,
    content: text,
    event: "redirect.drift.check",
    monitor: {
      id: baseline.id,
      label: baseline.label,
      startUrl: baseline.startUrl,
      expectedFinalUrl: baseline.expectedFinalUrl,
      expectedRedirects: baseline.expectedRedirects,
    },
    verdict,
    liveSummary: {
      finalUrl: live.finalUrl,
      finalStatus: live.finalStatus,
      totalRedirects: live.totalRedirects,
      totalResponseTimeMs: live.totalResponseTimeMs,
    },
  };
}
