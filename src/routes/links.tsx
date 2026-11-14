import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  ArrowLeft,
  BarChart3,
  CalendarClock,
  Check,
  Download,
  GitBranch,
  HeartPulse,
  Link2,
  Loader2,
  Pencil,
  Plus,
  Search,
  Tag,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { AdsterraNativeBanner } from "@/components/AdsterraNativeBanner";
import { BrowserExtensionPanel } from "@/components/analyzer/BrowserExtensionPanel";
import { CopyButton } from "@/components/analyzer/CopyButton";
import { LinkAnalyticsPanel } from "@/components/links/LinkAnalyticsPanel";
import { RuleBuilder } from "@/components/links/RuleBuilder";
import { ShortLinkQr } from "@/components/ShortLinkQr";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { CROSX_LOGO_URL } from "@/lib/brand";
import type { LinkRule } from "@/lib/link-rules";
import { csvCell } from "@/lib/redirect-export";
import { applyUtmParameters } from "@/lib/redirect-rules-codegen";
import { scanRedirectThreats } from "@/lib/threat-scanner";
import {
  buildCanonicalLinks,
  buildLinksStructuredData,
  buildPageMeta,
  LINKS_KEYWORDS,
  SITE_HOST,
  SITE_URL,
} from "@/lib/seo";
import {
  checkShortLinksHealth,
  createShortLink,
  deleteShortLink,
  type DestinationHealthResult,
  listShortLinks,
  setShortLinkEnabled,
  setShortLinkExpiry,
  type ShortLink,
  updateShortLinkDestination,
} from "@/lib/shortlinks.functions";

const TITLE = "Short Links — Redirect Chain Analyzer";
const DESCRIPTION =
  "Create transparent short URLs with custom slugs, QR codes, expiry, click counts and simple management — validated against unsafe destinations.";

export const Route = createFileRoute("/links")({
  head: () => ({
    meta: buildPageMeta({
      title: TITLE,
      description: DESCRIPTION,
      path: "/links",
      keywords: LINKS_KEYWORDS,
      twitterCard: "summary_large_image",
    }),
    links: buildCanonicalLinks("/links"),
    scripts: [
      {
        type: "application/ld+json",
        children: buildLinksStructuredData(DESCRIPTION),
      },
    ],
  }),
  component: LinksPage,
});

const OWNER_KEY = "crosx-shortlink-owner";

function useOwner(): string | null {
  const [owner, setOwner] = useState<string | null>(null);
  useEffect(() => {
    let value = localStorage.getItem(OWNER_KEY);
    if (!value) {
      value = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
      localStorage.setItem(OWNER_KEY, value);
    }
    setOwner(value);
  }, []);
  return owner;
}

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");

const isExpired = (l: ShortLink) =>
  !!l.expires_at && new Date(l.expires_at).getTime() <= Date.now();

function exportCsv(rows: ShortLink[], origin: string) {
  const header = [
    "slug",
    "short_url",
    "destination",
    "enabled",
    "clicks",
    "created_at",
    "last_clicked_at",
    "expires_at",
  ];
  const lines = rows.map((l) =>
    [
      l.slug,
      `${origin}/s/${l.slug}`,
      l.destination,
      String(l.enabled),
      String(l.clicks),
      l.created_at,
      l.last_clicked_at ?? "",
      l.expires_at ?? "",
    ]
      .map(csvCell)
      .join(","),
  );
  const blob = new Blob([header.map(csvCell).join(",") + "\n" + lines.join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "short-links.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

function LinksPage() {
  const owner = useOwner();
  const qc = useQueryClient();
  const [destination, setDestination] = useState("");
  const [slug, setSlug] = useState("");
  const [showUtmBuilder, setShowUtmBuilder] = useState(false);
  const [utmSource, setUtmSource] = useState("");
  const [utmMedium, setUtmMedium] = useState("");
  const [utmCampaign, setUtmCampaign] = useState("");
  const [utmTerm, setUtmTerm] = useState("");
  const [utmContent, setUtmContent] = useState("");
  const [search, setSearch] = useState("");
  const origin = SITE_URL;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [expiryId, setExpiryId] = useState<string | null>(null);
  const [expiryValue, setExpiryValue] = useState("");
  const [analyticsId, setAnalyticsId] = useState<string | null>(null);
  const [rulesId, setRulesId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [importingCsv, setImportingCsv] = useState(false);
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [healthMap, setHealthMap] = useState<Record<string, DestinationHealthResult>>({});
  const csvInputRef = useRef<HTMLInputElement | null>(null);

  const list = useServerFn(listShortLinks);
  const create = useServerFn(createShortLink);
  const toggle = useServerFn(setShortLinkEnabled);
  const remove = useServerFn(deleteShortLink);
  const updateDest = useServerFn(updateShortLinkDestination);
  const setExpiry = useServerFn(setShortLinkExpiry);
  const checkHealthFn = useServerFn(checkShortLinksHealth);

  const effectiveDestination = useMemo(() => {
    if (!destination.trim()) return "";
    const hasUtm = [utmSource, utmMedium, utmCampaign, utmTerm, utmContent].some((v) => v.trim());
    if (!hasUtm) return destination.trim();
    return applyUtmParameters(destination.trim(), {
      source: utmSource,
      medium: utmMedium,
      campaign: utmCampaign,
      term: utmTerm,
      content: utmContent,
    });
  }, [destination, utmSource, utmMedium, utmCampaign, utmTerm, utmContent]);

  const destinationThreatScan = useMemo(() => {
    const raw = effectiveDestination || destination.trim();
    if (!raw || !/^https?:\/\/\S+/i.test(raw)) return null;
    try {
      const parsed = new URL(raw);
      return scanRedirectThreats({
        startUrl: parsed.toString(),
        finalUrl: parsed.toString(),
        finalStatus: 200,
        totalHops: 1,
        totalRedirects: 0,
        totalResponseTimeMs: 0,
        redirectLoop: false,
        hops: [
          {
            index: 0,
            url: parsed.toString(),
            status: 200,
            statusText: "OK",
            location: null,
            resolvedLocation: null,
            responseTimeMs: 0,
            headers: {
              "strict-transport-security": parsed.protocol === "https:" ? "max-age=31536000" : "",
            },
            protocol: parsed.protocol === "https:" ? "https" : "http",
            params: Object.fromEntries(parsed.searchParams.entries()),
            redirectType: "200 Final",
            mechanism: "final-response",
            server: null,
            ip: null,
          },
        ],
        seo: {
          finalStatus: 200,
          https: parsed.protocol === "https:",
          canonical: null,
          metaRobots: null,
          chainLength: 0,
        },
        issues: [],
        tracking: {
          lostTrackingParams: [],
          keptTrackingParams: [],
          diffs: [],
          startParams: {},
          finalParams: {},
        },
        source: "live",
        error: null,
        analyzedAt: new Date().toISOString(),
      });
    } catch {
      return null;
    }
  }, [destination, effectiveDestination]);

  const links = useQuery({
    queryKey: ["short-links", owner],
    queryFn: () => list({ data: { owner: owner! } }),
    enabled: !!owner,
    retry: false,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["short-links"] });

  async function handleCheckHealth() {
    if (!owner || filtered.length === 0) return;
    setCheckingHealth(true);
    try {
      const items = filtered.slice(0, 20).map((l) => ({ id: l.id, url: l.destination }));
      const results = await checkHealthFn({ data: { owner, items } });
      const next: Record<string, DestinationHealthResult> = { ...healthMap };
      for (const r of results) {
        next[r.id] = r;
      }
      setHealthMap(next);
      const brokenCount = results.filter((r) => !r.ok).length;
      if (brokenCount === 0) {
        toast.success(`All ${results.length} destination URL(s) responded healthy`);
      } else {
        toast.warning(`${brokenCount} of ${results.length} destination URL(s) reported issues`);
      }
    } catch (err) {
      toast.error((err as Error).message || "Destination health check failed");
    } finally {
      setCheckingHealth(false);
    }
  }

  async function handleImportCsv(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !owner) return;
    setImportingCsv(true);
    try {
      const text = await file.text();
      const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      let created = 0;
      let failed = 0;
      for (const line of lines.slice(0, 50)) {
        const parts = line.split(",").map((p) => p.replace(/^"|"$/g, "").trim());
        const first = parts[0] ?? "";
        const second = parts[1] ?? "";
        if (!first || first.toLowerCase() === "destination" || first.toLowerCase() === "slug") {
          continue;
        }
        const isFirstUrl = /^https?:\/\//i.test(first);
        const dest = isFirstUrl
          ? first
          : parts[2] && /^https?:\/\//i.test(parts[2])
            ? parts[2]
            : second;
        const customSlug = isFirstUrl ? second : first;
        if (!dest || !/^https?:\/\//i.test(dest)) continue;
        try {
          await create({
            data: {
              destination: dest,
              slug: customSlug ? customSlug.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) : undefined,
              owner,
            },
          });
          created++;
        } catch {
          failed++;
        }
      }
      refresh();
      if (created > 0) {
        toast.success(`Imported ${created} short link${created === 1 ? "" : "s"}`, {
          description: failed > 0 ? `${failed} row(s) skipped` : undefined,
        });
      } else {
        toast.error("No valid short links found in CSV (expected destination,slug)");
      }
    } catch (err) {
      toast.error((err as Error).message || "Failed to import CSV");
    } finally {
      setImportingCsv(false);
    }
  }

  const createMut = useMutation({
    mutationFn: () =>
      create({
        data: {
          destination: effectiveDestination || destination.trim(),
          slug: slug.trim() || undefined,
          owner: owner!,
        },
      }),
    onSuccess: (row) => {
      const url = `${origin}/s/${row.slug}`;
      toast.success("Short link created", { description: url });
      void navigator.clipboard?.writeText(url).catch(() => {});
      setDestination("");
      setSlug("");
      setUtmSource("");
      setUtmMedium("");
      setUtmCampaign("");
      setUtmTerm("");
      setUtmContent("");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const all = useMemo(() => links.data ?? [], [links.data]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter((l) => `${l.slug} ${l.destination}`.toLowerCase().includes(q));
  }, [all, search]);
  const totalClicks = useMemo(() => all.reduce((sum, l) => sum + l.clicks, 0), [all]);
  const activeCount = useMemo(() => all.filter((l) => l.enabled && !isExpired(l)).length, [all]);

  return (
    <div className="bg-hero min-h-screen">
      <header className="app-safe-top sticky top-0 z-30 border-b border-hairline bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3 sm:gap-4 sm:px-6">
          <Link to="/" aria-label="CROSX home" className="flex shrink-0 items-center">
            <img
              src={CROSX_LOGO_URL}
              alt="CROSX Advertising & Marketing Agency"
              width={160}
              height={28}
              decoding="async"
              loading="eager"
              fetchPriority="high"
              className="h-6 w-auto max-w-[130px] object-contain object-left sm:h-7 sm:max-w-[160px]"
            />
          </Link>
          <span aria-hidden="true" className="h-6 w-px shrink-0 bg-hairline" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[14.5px] font-semibold leading-tight tracking-tight text-foreground sm:text-[15.5px]">
              Short Links
            </h1>
            <p className="hidden truncate text-[11px] leading-tight text-muted-foreground sm:block">
              Transparent 302 shortener with QR codes, smart rules and click analytics
            </p>
          </div>
          <nav aria-label="Primary navigation" className="flex shrink-0 items-center gap-2">
            <Button asChild variant="subtle" size="sm">
              <Link to="/">
                <ArrowLeft className="size-3.5" />
                <span className="hidden sm:inline">Analyzer</span>
              </Link>
            </Button>
            <ThemeToggle />
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-5 px-4 py-7 sm:px-6 sm:py-10">
        <form
          className="panel animate-reveal space-y-3 p-4 sm:p-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (owner && destination.trim()) createMut.mutate();
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Link2 className="size-4 text-brand" /> Create a short link
            </div>
            <Button
              type="button"
              variant={showUtmBuilder ? "subtle" : "ghost"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setShowUtmBuilder((v) => !v)}
            >
              <Tag className="size-3.5 text-brand" />
              UTM Campaign Builder
            </Button>
          </div>
          <Input
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="https://example.com/landing?utm_source=newsletter"
            inputMode="url"
            spellCheck={false}
            className="h-11 rounded-xl border-hairline bg-surface-muted font-mono text-sm"
          />

          {destinationThreatScan && destinationThreatScan.findings.length > 0 ? (
            <div className="rounded-xl border border-warning/35 bg-warning/10 px-3 py-2 text-xs text-foreground">
              <span className="font-semibold text-warning">
                Threat Scanner Notice ({destinationThreatScan.riskLabel}):{" "}
              </span>
              {destinationThreatScan.findings.map((f) => f.title).join(" · ")}
            </div>
          ) : null}

          {showUtmBuilder && (
            <div className="space-y-2.5 rounded-xl border border-hairline bg-surface-muted/60 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  UTM Parameters (automatically appended to destination)
                </p>
                {[utmSource, utmMedium, utmCampaign, utmTerm, utmContent].some((v) => v.trim()) && (
                  <button
                    type="button"
                    onClick={() => {
                      setUtmSource("");
                      setUtmMedium("");
                      setUtmCampaign("");
                      setUtmTerm("");
                      setUtmContent("");
                    }}
                    className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
                  >
                    Clear UTM
                  </button>
                )}
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <Input
                  value={utmSource}
                  onChange={(e) => setUtmSource(e.target.value)}
                  placeholder="utm_source (e.g. newsletter)"
                  className="h-9 border-hairline bg-background font-mono text-xs"
                />
                <Input
                  value={utmMedium}
                  onChange={(e) => setUtmMedium(e.target.value)}
                  placeholder="utm_medium (e.g. email)"
                  className="h-9 border-hairline bg-background font-mono text-xs"
                />
                <Input
                  value={utmCampaign}
                  onChange={(e) => setUtmCampaign(e.target.value)}
                  placeholder="utm_campaign (e.g. spring_launch)"
                  className="h-9 border-hairline bg-background font-mono text-xs"
                />
                <Input
                  value={utmTerm}
                  onChange={(e) => setUtmTerm(e.target.value)}
                  placeholder="utm_term (optional)"
                  className="h-9 border-hairline bg-background font-mono text-xs"
                />
                <Input
                  value={utmContent}
                  onChange={(e) => setUtmContent(e.target.value)}
                  placeholder="utm_content (optional)"
                  className="h-9 border-hairline bg-background font-mono text-xs sm:col-span-2"
                />
              </div>
              {effectiveDestination && effectiveDestination !== destination.trim() && (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-hairline bg-background px-2.5 py-1.5">
                  <p className="truncate font-mono text-[11px] text-brand">
                    {effectiveDestination}
                  </p>
                  <CopyButton value={effectiveDestination} label="Copy tagged URL" />
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
            <div className="flex h-11 flex-1 items-center rounded-xl border border-hairline bg-surface-muted pl-3 font-mono text-sm text-muted-foreground">
              <span className="shrink-0 truncate">{`${SITE_HOST}/s/`}</span>
              <Input
                value={slug}
                onChange={(e) => setSlug(e.target.value.replace(/[^A-Za-z0-9_-]/g, ""))}
                placeholder="custom-slug (optional)"
                maxLength={40}
                className="h-full border-0 bg-transparent font-mono shadow-none focus-visible:ring-0"
              />
            </div>
            <Button
              type="submit"
              variant="hero"
              size="lg"
              className="h-11 shrink-0"
              disabled={!owner || !destination.trim() || createMut.isPending}
            >
              {createMut.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              Shorten
            </Button>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Short links use a standard 302 redirect. Local/internal addresses, non-http(s) schemes,
            embedded credentials and links to other short links are rejected. Links are tied to this
            browser.
          </p>
        </form>

        {!owner || links.isLoading ? (
          <div aria-hidden="true" className="grid grid-cols-3 gap-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="panel flex flex-col items-center p-3 sm:p-4">
                <Skeleton className="h-7 w-12 rounded-md" />
                <Skeleton className="mt-1.5 h-3 w-16 rounded-full" />
              </div>
            ))}
          </div>
        ) : all.length > 0 ? (
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Total links", value: all.length },
              { label: "Active", value: activeCount },
              { label: "Total clicks", value: totalClicks },
            ].map((s) => (
              <div key={s.label} className="panel animate-rise p-3 text-center sm:p-4">
                <p className="text-xl font-bold tabular-nums text-foreground sm:text-2xl">
                  {s.value}
                </p>
                <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>
        ) : null}

        <section className="panel animate-rise p-4 sm:p-6">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search your links"
              className="h-9 flex-1 border-hairline bg-surface-muted text-sm"
            />
            <input
              ref={csvInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleImportCsv}
            />
            <Button
              type="button"
              variant="subtle"
              size="sm"
              className="shrink-0"
              disabled={!owner || importingCsv}
              onClick={() => csvInputRef.current?.click()}
            >
              {importingCsv ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Upload className="size-3.5" />
              )}
              <span className="hidden sm:inline">Import CSV</span>
            </Button>
            {all.length > 0 && (
              <>
                <Button
                  type="button"
                  variant="subtle"
                  size="sm"
                  className="shrink-0"
                  disabled={checkingHealth || filtered.length === 0}
                  onClick={() => void handleCheckHealth()}
                >
                  {checkingHealth ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <HeartPulse className="size-3.5 text-brand" />
                  )}
                  <span className="hidden sm:inline">Check Health</span>
                </Button>
                <Button
                  variant="subtle"
                  size="sm"
                  className="shrink-0"
                  onClick={() => exportCsv(filtered, origin)}
                >
                  <Download className="size-3.5" />
                  <span className="hidden sm:inline">Export CSV</span>
                </Button>
              </>
            )}
          </div>

          {!owner || links.isLoading ? (
            <div
              role="status"
              aria-live="polite"
              aria-label="Loading short links"
              data-testid="links-skeleton"
              className="divide-y divide-hairline"
            >
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="flex flex-col gap-3 py-3.5 first:pt-1 last:pb-1 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-4 w-28 rounded-md" />
                      <Skeleton className="size-6 rounded-md" />
                      <Skeleton className="h-4 w-16 rounded-full" />
                    </div>
                    <Skeleton className="h-3.5 w-4/5 rounded-md sm:w-2/3" />
                    <Skeleton className="h-3 w-56 rounded-full" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    {Array.from({ length: 6 }).map((_, idx) => (
                      <Skeleton key={idx} className="size-8 rounded-md" />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : links.isError ? (
            <p className="py-6 text-center text-sm text-destructive">
              {(links.error as Error).message}
            </p>
          ) : filtered.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {links.data?.length ? "No links match your search." : "No short links yet."}
            </p>
          ) : (
            <ul className="divide-y divide-hairline">
              {filtered.map((l) => {
                const shortUrl = `${origin}/s/${l.slug}`;
                const expired = isExpired(l);
                const editing = editingId === l.id;
                const settingExpiry = expiryId === l.id;
                const viewingAnalytics = analyticsId === l.id;
                const editingRules = rulesId === l.id;
                const confirmingDelete = confirmDeleteId === l.id;
                const ruleList = (Array.isArray(l.rules) ? l.rules : []) as LinkRule[];
                const health = healthMap[l.id];
                return (
                  <li key={l.id} className="flex flex-col gap-2 py-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <a
                            href={shortUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="truncate font-mono text-sm font-semibold text-brand"
                          >
                            /s/{l.slug}
                          </a>
                          <CopyButton value={shortUrl} label="Copy short URL" />
                          {expired && (
                            <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive">
                              Expired
                            </span>
                          )}
                          {ruleList.length > 0 && (
                            <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold text-brand">
                              {ruleList.length} rule{ruleList.length === 1 ? "" : "s"}
                              {ruleList.some(
                                (r) =>
                                  r.enabled && r.conditions.some((c) => c.field === "ab_split"),
                              )
                                ? " · A/B Split"
                                : ""}
                            </span>
                          )}
                          {checkingHealth && !health ? (
                            <Skeleton className="h-4 w-24 rounded-full" />
                          ) : health ? (
                            <span
                              className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${
                                health.ok
                                  ? "bg-status-2xx-bg text-status-2xx"
                                  : "bg-status-5xx-bg text-status-5xx"
                              }`}
                              title={health.error ?? health.finalUrl ?? undefined}
                            >
                              {health.status ?? "ERR"} {health.ok ? "OK" : health.statusText} ·{" "}
                              {health.latencyMs}ms
                            </span>
                          ) : null}
                        </div>
                        <p className="truncate font-mono text-[11.5px] text-muted-foreground">
                          {l.destination}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {l.clicks} click{l.clicks === 1 ? "" : "s"} · created {fmt(l.created_at)}{" "}
                          · last click {fmt(l.last_clicked_at)}
                          {l.expires_at && ` · expires ${fmt(l.expires_at)}`}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                        <Button
                          asChild
                          variant="ghost"
                          size="sm"
                          aria-label="Trace short link"
                          title="Trace this short link in the analyzer"
                        >
                          <a href={`/?url=${encodeURIComponent(shortUrl)}`}>
                            <Activity className="size-4" />
                          </a>
                        </Button>
                        <ShortLinkQr url={shortUrl} slug={l.slug} />
                        <Button
                          variant={viewingAnalytics ? "subtle" : "ghost"}
                          size="sm"
                          aria-label="Link analytics"
                          onClick={() => {
                            setAnalyticsId(viewingAnalytics ? null : l.id);
                            setRulesId(null);
                          }}
                        >
                          <BarChart3 className="size-4" />
                        </Button>
                        <Button
                          variant={editingRules ? "subtle" : "ghost"}
                          size="sm"
                          aria-label="Smart redirect rules"
                          onClick={() => {
                            setRulesId(editingRules ? null : l.id);
                            setAnalyticsId(null);
                          }}
                        >
                          <GitBranch className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label="Edit destination"
                          onClick={() => {
                            setEditingId(editing ? null : l.id);
                            setEditValue(l.destination);
                            setExpiryId(null);
                          }}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label="Set expiry"
                          onClick={() => {
                            setExpiryId(settingExpiry ? null : l.id);
                            setExpiryValue(
                              l.expires_at ? new Date(l.expires_at).toISOString().slice(0, 16) : "",
                            );
                            setEditingId(null);
                          }}
                        >
                          <CalendarClock className="size-4" />
                        </Button>
                        <Switch
                          checked={l.enabled}
                          aria-label={l.enabled ? "Disable link" : "Enable link"}
                          onCheckedChange={(v) =>
                            toggle({ data: { id: l.id, enabled: v, owner: owner! } })
                              .then(refresh)
                              .catch((e: Error) => toast.error(e.message))
                          }
                        />
                        {confirmingDelete ? (
                          <div className="flex items-center gap-1">
                            <Button
                              variant="destructive"
                              size="sm"
                              aria-label="Confirm delete"
                              onClick={() => {
                                setConfirmDeleteId(null);
                                remove({ data: { id: l.id, owner: owner! } })
                                  .then(() => {
                                    toast.success("Link deleted");
                                    refresh();
                                  })
                                  .catch((e: Error) => toast.error(e.message));
                              }}
                            >
                              Delete
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label="Cancel delete"
                              onClick={() => setConfirmDeleteId(null)}
                            >
                              <X className="size-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label="Delete link"
                            onClick={() => setConfirmDeleteId(l.id)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        )}
                      </div>
                    </div>

                    {editing && (
                      <form
                        className="flex flex-col gap-2 sm:flex-row"
                        onSubmit={(e) => {
                          e.preventDefault();
                          updateDest({
                            data: { id: l.id, destination: editValue.trim(), owner: owner! },
                          })
                            .then(() => {
                              toast.success("Destination updated");
                              setEditingId(null);
                              refresh();
                            })
                            .catch((err: Error) => toast.error(err.message));
                        }}
                      >
                        <Input
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          inputMode="url"
                          spellCheck={false}
                          className="h-9 flex-1 border-hairline bg-surface-muted font-mono text-sm"
                        />
                        <div className="flex gap-2">
                          <Button
                            type="submit"
                            variant="hero"
                            size="sm"
                            disabled={!editValue.trim()}
                          >
                            <Check className="size-3.5" /> Save
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditingId(null)}
                          >
                            <X className="size-3.5" /> Cancel
                          </Button>
                        </div>
                      </form>
                    )}

                    {settingExpiry && (
                      <form
                        className="flex flex-col gap-2 sm:flex-row sm:items-center"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const iso = expiryValue ? new Date(expiryValue).toISOString() : null;
                          setExpiry({ data: { id: l.id, expiresAt: iso, owner: owner! } })
                            .then(() => {
                              toast.success(iso ? "Expiry set" : "Expiry removed");
                              setExpiryId(null);
                              refresh();
                            })
                            .catch((err: Error) => toast.error(err.message));
                        }}
                      >
                        <Input
                          type="datetime-local"
                          value={expiryValue}
                          onChange={(e) => setExpiryValue(e.target.value)}
                          className="h-9 flex-1 border-hairline bg-surface-muted text-sm"
                        />
                        <div className="flex gap-2">
                          <Button type="submit" variant="hero" size="sm">
                            <Check className="size-3.5" />{" "}
                            {expiryValue ? "Set expiry" : "Remove expiry"}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setExpiryId(null)}
                          >
                            <X className="size-3.5" /> Cancel
                          </Button>
                        </div>
                      </form>
                    )}

                    {viewingAnalytics && owner && (
                      <LinkAnalyticsPanel id={l.id} slug={l.slug} owner={owner} rules={ruleList} />
                    )}

                    {editingRules && owner && (
                      <RuleBuilder
                        id={l.id}
                        owner={owner}
                        initial={ruleList}
                        defaultDestination={l.destination}
                        onSaved={() => {
                          setRulesId(null);
                          refresh();
                        }}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <BrowserExtensionPanel />

        <footer className="space-y-2 border-t border-hairline pt-4 text-center font-mono text-[11px] leading-relaxed text-muted-foreground">
          <nav
            aria-label="Footer navigation"
            className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px]"
          >
            <Link to="/" className="hover:text-foreground">
              Redirect Chain Analyzer
            </Link>
            <span aria-hidden="true">·</span>
            <Link to="/links" className="hover:text-foreground">
              Short Links &amp; UTM Builder
            </Link>
            <span aria-hidden="true">·</span>
            <Link to="/api-docs" className="hover:text-foreground">
              Chain Tracer JSON API
            </Link>
            <span aria-hidden="true">·</span>
            <a href="/sitemap.xml" className="hover:text-foreground">
              Sitemap
            </a>
            <span aria-hidden="true">·</span>
            <a href="/llms.txt" className="hover:text-foreground">
              LLMs.txt
            </a>
          </nav>
        </footer>
        <AdsterraNativeBanner />
      </main>
    </div>
  );
}
