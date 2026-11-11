import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  BellRing,
  CheckCircle2,
  Clock,
  Loader2,
  Play,
  Plus,
  Send,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { dispatchMonitorWebhook } from "@/lib/enterprise-tools.functions";
import {
  createBaselineFromAnalysis,
  evaluateRedirectDrift,
  formatWebhookPayload,
  type MonitoredRedirectBaseline,
} from "@/lib/redirect-monitor";
import { analyzeUrls } from "@/lib/redirect-service";
import type { RedirectAnalysis } from "@/lib/redirect-types";

const MONITOR_STORAGE_KEY = "crosx-redirect-monitors-v1";

export function RedirectMonitorPanel({ activeResults }: { activeResults: RedirectAnalysis[] }) {
  const [monitors, setMonitors] = useState<MonitoredRedirectBaseline[]>([]);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [intervalMinutes, setIntervalMinutes] = useState<"15" | "60" | "360" | "1440">("60");
  const [autoPoll, setAutoPoll] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [checkingAll, setCheckingAll] = useState(false);
  const [testingWebhookId, setTestingWebhookId] = useState<string | null>(null);

  const sendWebhookFn = useServerFn(dispatchMonitorWebhook);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(MONITOR_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as MonitoredRedirectBaseline[];
        if (Array.isArray(parsed)) setMonitors(parsed);
      }
    } catch {
      // ignore corrupt storage
    }
  }, []);

  const saveMonitors = useCallback((next: MonitoredRedirectBaseline[]) => {
    setMonitors(next);
    try {
      localStorage.setItem(MONITOR_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore storage errors
    }
  }, []);

  function handlePinActiveResult(analysis: RedirectAnalysis) {
    const existing = monitors.find((m) => m.startUrl === analysis.startUrl);
    const baseline = createBaselineFromAnalysis(analysis, {
      intervalMinutes: Number(intervalMinutes) as 15 | 60 | 360 | 1440,
      webhookUrl: webhookUrl.trim() || existing?.webhookUrl,
    });
    const next = [baseline, ...monitors.filter((m) => m.startUrl !== analysis.startUrl)].slice(
      0,
      15,
    );
    saveMonitors(next);
    toast.success("Pinned to Redirect Drift Monitor", {
      description: `Baseline: ${baseline.expectedRedirects} hop(s) → ${baseline.expectedFinalUrl}`,
    });
  }

  async function runSingleCheck(monitor: MonitoredRedirectBaseline) {
    setCheckingId(monitor.id);
    try {
      const { results } = await analyzeUrls([monitor.startUrl], monitor.userAgentPreset);
      const live = results[0];
      if (!live) throw new Error("No trace response returned");

      const verdict = evaluateRedirectDrift(monitor, live);
      const updated: MonitoredRedirectBaseline = {
        ...monitor,
        lastCheckedAt: verdict.checkedAt,
        lastStatus: verdict.status,
        lastDriftSummary: verdict.summary,
        webhookUrl: webhookUrl.trim() || monitor.webhookUrl,
      };

      const next = monitors.map((m) => (m.id === monitor.id ? updated : m));
      saveMonitors(next);

      if (verdict.status === "healthy") {
        toast.success(`No drift detected for ${monitor.startUrl}`);
      } else {
        toast.warning(`Redirect drift detected!`, {
          description: verdict.summary,
        });
        const targetWebhook = updated.webhookUrl;
        if (targetWebhook) {
          const payload = formatWebhookPayload(updated, verdict, live);
          await sendWebhookFn({ data: { webhookUrl: targetWebhook, payload } }).catch(() => {});
        }
      }
    } catch (err) {
      toast.error((err as Error).message || "Monitor check failed");
    } finally {
      setCheckingId(null);
    }
  }

  const runCheckAll = useCallback(async () => {
    if (monitors.length === 0 || checkingAll) return;
    setCheckingAll(true);
    try {
      const updatedList: MonitoredRedirectBaseline[] = [];
      let driftedCount = 0;

      for (const mon of monitors) {
        try {
          const { results } = await analyzeUrls([mon.startUrl], mon.userAgentPreset);
          const live = results[0];
          if (live) {
            const verdict = evaluateRedirectDrift(mon, live);
            if (verdict.status !== "healthy") driftedCount++;
            updatedList.push({
              ...mon,
              lastCheckedAt: verdict.checkedAt,
              lastStatus: verdict.status,
              lastDriftSummary: verdict.summary,
            });
          } else {
            updatedList.push(mon);
          }
        } catch {
          updatedList.push(mon);
        }
      }

      saveMonitors(updatedList);
      if (driftedCount === 0) {
        toast.success(`All ${updatedList.length} monitored redirect baselines are healthy`);
      } else {
        toast.warning(`${driftedCount} of ${updatedList.length} monitored URLs showed drift`);
      }
    } finally {
      setCheckingAll(false);
    }
  }, [checkingAll, monitors, saveMonitors]);

  useEffect(() => {
    if (!autoPoll || monitors.length === 0) return;
    const ms = Math.max(60_000, Number(intervalMinutes) * 60_000);
    const timer = setInterval(() => {
      void runCheckAll();
    }, ms);
    return () => clearInterval(timer);
  }, [autoPoll, intervalMinutes, monitors.length, runCheckAll]);

  async function handleTestWebhook(monitor: MonitoredRedirectBaseline) {
    const targetUrl = webhookUrl.trim() || monitor.webhookUrl;
    if (!targetUrl) {
      toast.error("Enter a Slack, Discord, or HTTPS Webhook URL first");
      return;
    }
    setTestingWebhookId(monitor.id);
    try {
      const payload = {
        text: `🔔 **[CROSX Redirect Monitor — Test Alert]**\n• **Monitored URL**: ${monitor.startUrl}\n• **Expected Final Destination**: ${monitor.expectedFinalUrl}\n• **Expected Hops**: ${monitor.expectedRedirects}`,
        content: `🔔 **[CROSX Redirect Monitor — Test Alert]**\n• **Monitored URL**: ${monitor.startUrl}\n• **Expected Final Destination**: ${monitor.expectedFinalUrl}\n• **Expected Hops**: ${monitor.expectedRedirects}`,
        event: "redirect.monitor.test",
        monitor,
      };
      const res = await sendWebhookFn({ data: { webhookUrl: targetUrl, payload } });
      if (res.ok) {
        toast.success(`Webhook delivered (HTTP ${res.status})`);
      } else {
        toast.warning(`Webhook endpoint returned HTTP ${res.status}`);
      }
    } catch (err) {
      toast.error((err as Error).message || "Webhook test failed");
    } finally {
      setTestingWebhookId(null);
    }
  }

  return (
    <section
      aria-labelledby="redirect-monitor-heading"
      className="panel animate-rise space-y-4 p-4 sm:p-6"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.09em] text-brand">
            <BellRing className="size-3.5" />
            Scheduled Redirect Drift &amp; Uptime Monitor
          </span>
          <h3
            id="redirect-monitor-heading"
            className="mt-0.5 text-base font-semibold tracking-tight text-foreground"
          >
            Pin critical URLs and alert on unexpected hop changes or dropped UTMs
          </h3>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Clock className="size-3.5 text-muted-foreground" />
            <Label htmlFor="auto-poll-switch" className="text-xs font-medium text-muted-foreground">
              Live Auto-Poll
            </Label>
            <Switch
              id="auto-poll-switch"
              checked={autoPoll}
              onCheckedChange={(v) => {
                setAutoPoll(v);
                toast.message(
                  v ? "Live background drift polling enabled" : "Background drift polling paused",
                );
              }}
            />
          </div>
          {monitors.length > 0 ? (
            <Button
              type="button"
              variant="subtle"
              size="sm"
              disabled={checkingAll}
              onClick={() => void runCheckAll()}
            >
              {checkingAll ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Activity className="size-3.5 text-brand" />
              )}
              Check All Baselines ({monitors.length})
            </Button>
          ) : null}
        </div>
      </div>

      {/* Configuration & Quick Pin Bar */}
      <div className="grid gap-2.5 rounded-xl border border-hairline bg-surface-muted/50 p-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label
            htmlFor="monitor-webhook-input"
            className="block text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground"
          >
            Alert Webhook URL (Slack, Discord, or Custom HTTPS JSON Endpoint)
          </label>
          <Input
            id="monitor-webhook-input"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://hooks.slack.com/services/... or https://discord.com/api/webhooks/..."
            inputMode="url"
            spellCheck={false}
            className="mt-1 h-9 border-hairline bg-background font-mono text-xs"
          />
        </div>
        <div>
          <label
            htmlFor="monitor-interval-select"
            className="block text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground"
          >
            Check Cadence
          </label>
          <Select
            value={intervalMinutes}
            onValueChange={(v) => setIntervalMinutes(v as "15" | "60" | "360" | "1440")}
          >
            <SelectTrigger
              id="monitor-interval-select"
              aria-label="Monitor check interval"
              className="mt-1 h-9 border-hairline bg-background font-mono text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="15">Every 15 minutes</SelectItem>
              <SelectItem value="60">Every 1 hour</SelectItem>
              <SelectItem value="360">Every 6 hours</SelectItem>
              <SelectItem value="1440">Every 24 hours (Daily)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Pin from currently analyzed results */}
      {activeResults.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand/25 bg-brand/5 px-3.5 py-2.5">
          <span className="text-xs text-foreground">
            Pin current trace as a monitored baseline ({activeResults[0]!.startUrl})
          </span>
          <div className="flex flex-wrap gap-1.5">
            {activeResults.slice(0, 3).map((r) => {
              let host = r.startUrl;
              try {
                host = new URL(r.startUrl).hostname;
              } catch {
                // ignore
              }
              return (
                <Button
                  key={r.startUrl}
                  type="button"
                  variant="hero"
                  size="sm"
                  onClick={() => handlePinActiveResult(r)}
                >
                  <Plus className="size-3.5" />
                  Monitor {host}
                </Button>
              );
            })}
          </div>
        </div>
      ) : null}

      {monitors.length === 0 ? (
        <p className="rounded-xl border border-dashed border-hairline p-4 text-center text-xs text-muted-foreground">
          No monitored URL baselines yet. Analyze any URL above (or click &ldquo;Load demo
          data&rdquo;) and click <strong>Monitor</strong> to track redirect drift, hop count
          changes, and UTM survival.
        </p>
      ) : (
        <ul className="divide-y divide-hairline rounded-xl border border-hairline bg-surface/60">
          {monitors.map((mon) => (
            <li
              key={mon.id}
              className="flex flex-col gap-2.5 p-3.5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {mon.lastStatus === "healthy" ? (
                    <CheckCircle2 className="size-3.5 shrink-0 text-success" />
                  ) : (
                    <TriangleAlert className="size-3.5 shrink-0 text-warning" />
                  )}
                  <span className="truncate font-mono text-xs font-semibold text-foreground">
                    {mon.startUrl}
                  </span>
                  <span className="font-mono text-[10.5px] text-muted-foreground">
                    · Every {mon.intervalMinutes}m · Expected: {mon.expectedRedirects} hop(s) →{" "}
                    {mon.expectedStatus ?? 200}
                  </span>
                </div>
                <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                  Expected final: {mon.expectedFinalUrl}
                </p>
                {mon.lastDriftSummary ? (
                  <p
                    className={`mt-0.5 font-mono text-[11px] ${
                      mon.lastStatus === "healthy" ? "text-muted-foreground" : "text-warning"
                    }`}
                  >
                    {mon.lastDriftSummary}
                  </p>
                ) : null}
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                <Button
                  type="button"
                  variant="subtle"
                  size="sm"
                  disabled={checkingId === mon.id}
                  onClick={() => void runSingleCheck(mon)}
                >
                  {checkingId === mon.id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Play className="size-3.5 text-brand" />
                  )}
                  Verify Drift
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={testingWebhookId === mon.id}
                  onClick={() => void handleTestWebhook(mon)}
                >
                  {testingWebhookId === mon.id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Send className="size-3.5" />
                  )}
                  Test Webhook
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove monitor for ${mon.startUrl}`}
                  onClick={() => saveMonitors(monitors.filter((item) => item.id !== mon.id))}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
