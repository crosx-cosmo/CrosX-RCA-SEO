import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bot, Download, MousePointerClick, Shuffle, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { LinkRule } from "@/lib/link-rules";
import { csvCell } from "@/lib/redirect-export";
import { exportLinkClicks, getLinkAnalytics, type Bucket } from "@/lib/shortlinks.functions";

const RANGES = [
  { label: "24h", days: 1 },
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
] as const;

function BucketList({ title, items, total }: { title: string; items: Bucket[]; total: number }) {
  return (
    <div className="rounded-xl border border-hairline bg-surface/60 p-3">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.11em] text-muted-foreground">
        {title}
      </p>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">No data yet</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((b) => (
            <li key={b.k} className="text-xs">
              <div className="flex justify-between gap-2">
                <span className="truncate text-foreground">{b.k}</span>
                <span className="tabular-nums text-muted-foreground">{b.n}</span>
              </div>
              <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500"
                  style={{ width: `${total ? (b.n / total) * 100 : 0}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function LinkAnalyticsPanel({
  id,
  slug,
  owner,
  rules = [],
}: {
  id: string;
  slug: string;
  owner: string;
  rules?: LinkRule[];
}) {
  const [days, setDays] = useState<number>(30);
  const get = useServerFn(getLinkAnalytics);
  const exp = useServerFn(exportLinkClicks);
  const window = useMemo(() => {
    const to = new Date(Date.now() + 60_000);
    const from = new Date(to.getTime() - days * 86_400_000);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [days]);

  const ruleNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rules) {
      m.set(r.id, r.name || `Rule #${r.id}`);
    }
    return m;
  }, [rules]);

  const q = useQuery({
    queryKey: ["link-analytics", id, days],
    queryFn: () => get({ data: { id, owner, ...window } }),
    retry: false,
  });

  async function download() {
    try {
      const rows = await exp({ data: { id, owner, ...window } });
      if (!rows.length) {
        toast.info("No clicks in this range");
        return;
      }
      const cols = Object.keys(rows[0]!);
      const csv = [
        cols.map(csvCell).join(","),
        ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(",")),
      ].join("\n");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      a.download = `clicks-${slug}-${days}d.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success("Click data exported");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const d = q.data;
  const max = Math.max(1, ...(d?.timeline.map((t) => t.clicks) ?? [1]));

  const ruleBuckets = useMemo<Bucket[]>(() => {
    if (!d?.recent) return [];
    const counts = new Map<string, number>();
    for (const r of d.recent) {
      const label = r.rule_id
        ? (ruleNameMap.get(r.rule_id) ?? `Rule ${r.rule_id}`)
        : "Default destination";
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([k, n]) => ({ k, n }))
      .sort((a, b) => b.n - a.n);
  }, [d?.recent, ruleNameMap]);

  return (
    <div className="animate-reveal relative space-y-3 overflow-hidden rounded-xl border border-hairline bg-surface-muted/40 p-3 sm:p-4">
      {q.isFetching && !q.isLoading ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-0.5 overflow-hidden bg-brand/15"
        >
          <div className="animate-shimmer h-full w-full bg-brand/50" />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-lg border border-hairline p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.label}
              type="button"
              onClick={() => setDays(r.days)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                days === r.days
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <Button variant="subtle" size="sm" onClick={download}>
          <Download className="size-3.5" /> Export clicks
        </Button>
      </div>

      {q.isLoading ? (
        <div
          role="status"
          aria-live="polite"
          aria-label="Loading link analytics"
          data-testid="analytics-skeleton"
          className="space-y-3"
        >
          <div className="grid grid-cols-3 gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-xl border border-hairline bg-surface/60 p-3">
                <Skeleton className="size-4 rounded-md" />
                <Skeleton className="mt-2 h-6 w-12 rounded-md" />
                <Skeleton className="mt-1.5 h-3 w-20 rounded-full" />
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-hairline bg-surface/60 p-3">
            <Skeleton className="mb-3 h-3 w-36 rounded-full" />
            <div className="flex h-24 items-end gap-1.5">
              {[32, 58, 44, 80, 62, 92, 48, 70, 86, 54, 64, 40].map((pct, i) => (
                <Skeleton
                  key={i}
                  className="flex-1 rounded-t-md rounded-b-none"
                  style={{ height: `${pct}%` }}
                />
              ))}
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="space-y-2 rounded-xl border border-hairline bg-surface/60 p-3"
              >
                <Skeleton className="h-3 w-24 rounded-full" />
                {[0, 1, 2].map((row) => (
                  <div key={row} className="space-y-1">
                    <div className="flex justify-between gap-2">
                      <Skeleton className="h-3 w-24 rounded-md" />
                      <Skeleton className="h-3 w-8 rounded-md" />
                    </div>
                    <Skeleton className="h-1 w-full rounded-full" />
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="space-y-2 rounded-xl border border-hairline bg-surface/60 p-3">
            <Skeleton className="h-3 w-28 rounded-full" />
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex justify-between gap-3 py-1">
                <Skeleton className="h-3 w-32 rounded-md" />
                <Skeleton className="h-3 w-40 rounded-md" />
              </div>
            ))}
          </div>
        </div>
      ) : q.error ? (
        <p className="text-sm text-destructive">{(q.error as Error).message}</p>
      ) : d ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            {[
              { icon: MousePointerClick, label: "Total clicks", v: d.total },
              { icon: Users, label: "Unique visitors", v: d.unique },
              { icon: Bot, label: "Bot hits", v: d.bots },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-hairline bg-surface/60 p-3">
                <s.icon className="size-3.5 text-muted-foreground" />
                <p className="mt-1 text-lg font-semibold tabular-nums">{s.v}</p>
                <p className="text-[10.5px] text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-hairline bg-surface/60 p-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.11em] text-muted-foreground">
              Timeline (clicks per day)
            </p>
            {d.timeline.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No clicks recorded in this range. Clicks appear here after the short link is opened.
              </p>
            ) : (
              <div className="flex h-24 items-end gap-1">
                {d.timeline.map((t) => (
                  <div
                    key={t.day}
                    title={`${t.day}: ${t.clicks} clicks, ${t.unique} unique`}
                    className="flex-1 rounded-t bg-primary/80 transition-all hover:bg-primary"
                    style={{ height: `${Math.max(4, (t.clicks / max) * 100)}%` }}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <BucketList title="Referrers" items={d.referrers} total={d.total} />
            <BucketList title="Countries" items={d.countries} total={d.total} />
            <BucketList title="Devices" items={d.devices} total={d.total} />
            <BucketList title="Browsers" items={d.browsers} total={d.total} />
            <BucketList title="Operating systems" items={d.os} total={d.total} />
            <BucketList title="UTM source / medium / campaign" items={d.utm} total={d.total} />
          </div>

          {rules.length > 0 ? (
            <div className="rounded-xl border border-hairline bg-surface/60 p-3">
              <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.11em] text-muted-foreground">
                <Shuffle className="size-3 text-brand" />
                Smart Rule &amp; A/B Split Variant Distribution (Recent Clicks)
              </p>
              {ruleBuckets.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No rule-matched clicks recorded yet.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {ruleBuckets.map((b) => (
                    <li key={b.k} className="text-xs">
                      <div className="flex justify-between gap-2">
                        <span className="truncate font-mono text-foreground">{b.k}</span>
                        <span className="tabular-nums text-muted-foreground">{b.n}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          <div className="rounded-xl border border-hairline bg-surface/60 p-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.11em] text-muted-foreground">
              Recent activity
            </p>
            {d.recent.length === 0 ? (
              <p className="text-xs text-muted-foreground">No activity yet</p>
            ) : (
              <ul className="divide-y divide-hairline text-xs">
                {d.recent.map((r, i) => (
                  <li key={i} className="flex flex-wrap justify-between gap-x-3 py-1.5">
                    <span className="text-muted-foreground">
                      {new Date(r.clicked_at).toLocaleString()}
                    </span>
                    <span className="text-foreground">
                      {[r.device, r.browser, r.os, r.country, r.referrer_host ?? "Direct"]
                        .filter(Boolean)
                        .join(" · ")}
                      {r.is_bot ? " · bot" : ""}
                      {r.rule_id ? ` · ${ruleNameMap.get(r.rule_id) ?? `rule:${r.rule_id}`}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="text-[10.5px] text-muted-foreground">
            Privacy: visitors are counted with a daily-rotating anonymous hash — IP addresses are
            never stored.
          </p>
        </>
      ) : null}
    </div>
  );
}
