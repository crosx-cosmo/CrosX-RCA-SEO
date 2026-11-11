import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Activity,
  BookOpen,
  Braces,
  ChevronDown,
  Clock,
  HelpCircle,
  History,
  Link2,
  Play,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import { CROSX_LOGO_URL } from "@/lib/brand";
import { buildCanonicalLinks, buildHomeStructuredData, buildPageMeta } from "@/lib/seo";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { BrowserExtensionPanel } from "@/components/analyzer/BrowserExtensionPanel";
import { ExportBar } from "@/components/analyzer/ExportBar";
import { RedirectMonitorPanel } from "@/components/analyzer/RedirectMonitorPanel";
import { ReportView } from "@/components/analyzer/ReportView";
import { StatusBadge } from "@/components/analyzer/StatusBadge";
import { EmptyState, ErrorState, LoadingState } from "@/components/analyzer/States";
import { UrlInputPanel } from "@/components/analyzer/UrlInputPanel";
import { InstallAppButton } from "@/components/InstallAppButton";
import { ThemeToggle } from "@/components/ThemeToggle";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { analysisKey, type ShareIdMap } from "@/lib/analysis-store";
import { USER_AGENT_PRESETS } from "@/lib/redirect-analysis";
import { activeBackend, analyzeUrls, demoAnalysis } from "@/lib/redirect-service";
import type { RedirectAnalysis, UserAgentPreset } from "@/lib/redirect-types";
import { AdsterraNativeBanner } from "@/components/AdsterraNativeBanner";

const TITLE = "Redirect & URL Trace Engine — Every Hop, HTTP or JavaScript";
const DESCRIPTION =
  "Trace any URL end to end: HTTP 301/302/307/308 redirects, meta refresh, JavaScript navigation, cloaked affiliate hops, loops, dead ends and tracking parameter loss.";

const RECENT_TRACES_KEY = "crosx-recent-traces-v1";
const MAX_RECENT_TRACES = 8;

const SEO_FAQS = [
  {
    q: "What is a redirect chain and why does it hurt SEO and conversions?",
    a: "A redirect chain occurs when a URL forwards through multiple intermediate hops (Hop A → Hop B → Hop C) before reaching the final landing page. Each extra hop adds DNS, TLS, and HTTP round-trip latency (hurting Core Web Vitals like LCP and TTFB), risks losing Googlebot crawl budget after 5–10 hops, and frequently strips UTM or affiliate click IDs when cross-domain redirects are misconfigured.",
  },
  {
    q: "How does Redirect Chain Analyzer detect JavaScript and meta refresh redirects?",
    a: 'Unlike basic HTTP header checkers that stop at status 200, our server-side trace engine inspects HTML responses for <meta http-equiv="refresh"> tags, canonical headers, and inline JavaScript navigation patterns (window.location, location.href, location.replace, location.assign), escalating to a sandboxed headless browser when cloaked client-side hops are detected.',
  },
  {
    q: "Why should I test URLs with different User-Agent profiles (Googlebot vs Mobile vs Desktop)?",
    a: "Many affiliate networks, geo-routers, and CDNs serve different redirect chains depending on the visitor's User-Agent. Switching between Desktop Chrome, iPhone iOS, Android Chrome, Googlebot Smartphone, and Social Preview bots exposes conditional redirects, mobile-only app-store traps, and SEO cloaking.",
  },
  {
    q: "What is the SEO difference between 301, 302, 307, and 308 redirects?",
    a: "301 (Moved Permanently) and 308 (Permanent Redirect, preserving HTTP method) instruct search engines to transfer indexing signals and canonical authority permanently to the destination URL. 302 (Found) and 307 (Temporary Redirect) signal a temporary move, which can leave search engines indexing the old URL if left in place long-term.",
  },
  {
    q: "How does the tracking parameter diff and Clean URL stripper work?",
    a: "Every hop's query string is parsed and compared against the previous hop. We highlight added, modified, or dropped parameters (such as utm_source, gclid, fbclid, click_id, aff_id, subid) and automatically generate a clean, canonical destination URL with tracking noise stripped for one-click sharing.",
  },
] as const;

export const Route = createFileRoute("/")({
  head: () => ({
    meta: buildPageMeta({
      title: TITLE,
      description: DESCRIPTION,
      path: "/",
    }),
    links: buildCanonicalLinks("/"),
    scripts: [
      {
        type: "application/ld+json",
        children: buildHomeStructuredData(DESCRIPTION),
      },
    ],
  }),

  component: AnalyzerPage,
});

function AnalyzerPage() {
  const [results, setResults] = useState<RedirectAnalysis[]>([]);
  const [shareIds, setShareIds] = useState<ShareIdMap>({});
  const [recentTraces, setRecentTraces] = useState<RedirectAnalysis[]>([]);
  const [initialUrl, setInitialUrl] = useState<string>("");
  const autoTracedRef = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(RECENT_TRACES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as RedirectAnalysis[];
        if (Array.isArray(parsed)) setRecentTraces(parsed.slice(0, MAX_RECENT_TRACES));
      }
    } catch {
      /* ignore corrupt localStorage */
    }
  }, []);

  function saveRecentTraces(newItems: RedirectAnalysis[]) {
    setRecentTraces((prev) => {
      const merged = [...newItems, ...prev].filter(
        (item, idx, arr) => arr.findIndex((x) => x.startUrl === item.startUrl) === idx,
      );
      const sliced = merged.slice(0, MAX_RECENT_TRACES);
      try {
        localStorage.setItem(RECENT_TRACES_KEY, JSON.stringify(sliced));
      } catch {
        /* ignore storage quota errors */
      }
      return sliced;
    });
  }

  function clearRecentTraces() {
    setRecentTraces([]);
    try {
      localStorage.removeItem(RECENT_TRACES_KEY);
    } catch {
      /* ignore */
    }
    toast.success("Recent trace history cleared");
  }

  const mutation = useMutation({
    mutationFn: ({ urls, userAgent }: { urls: string[]; userAgent?: UserAgentPreset }) =>
      analyzeUrls(urls, userAgent),
    onSuccess: ({ results: data, shareIds: ids }) => {
      setResults(data);
      setShareIds(ids);
      saveRecentTraces(data);
      toast.success(`Analyzed ${data.length} URL${data.length === 1 ? "" : "s"}`);
    },
    onError: (error: Error) => toast.error(error.message || "Analysis failed"),
  });

  useEffect(() => {
    if (autoTracedRef.current || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const urlParam = params.get("url")?.trim();
    const uaParam = params.get("ua")?.trim() as UserAgentPreset | undefined;
    if (urlParam) {
      autoTracedRef.current = true;
      setInitialUrl(urlParam);
      mutation.mutate({ urls: [urlParam], userAgent: uaParam || "desktop-chrome" });
    }
  }, [mutation]);

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
              Redirect Chain Analyzer
            </h1>
            <p className="hidden truncate text-[11px] leading-tight text-muted-foreground sm:block">
              Universal redirect + URL tracing for SEO and affiliate links
            </p>
          </div>
          <nav aria-label="Primary navigation" className="flex shrink-0 items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  className="hidden gap-1.5 border-hairline bg-surface/80 py-1 font-medium text-muted-foreground sm:flex"
                >
                  <ShieldCheck className="size-3 text-success" />
                  {activeBackend() === "external" ? "External API" : "Live server tracing"}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                Requests are performed server-side, never in the browser
              </TooltipContent>
            </Tooltip>
            <Button asChild variant="subtle" size="sm">
              <Link to="/links">
                <Link2 className="size-3.5" />
                <span className="hidden sm:inline">Links</span>
              </Link>
            </Button>
            <Button asChild variant="subtle" size="sm">
              <Link to="/api-docs">
                <Braces className="size-3.5" />
                <span className="hidden sm:inline">API</span>
              </Link>
            </Button>
            <InstallAppButton />
            <ThemeToggle />
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-5 px-4 py-7 sm:px-6 sm:py-10">
        <section className="animate-reveal">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface/80 px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted-foreground shadow-soft">
            <span className="size-1.5 rounded-full bg-success" />
            Redirect forensics
          </span>
          <h2 className="mt-3 text-[26px] font-semibold leading-[1.12] tracking-tight text-foreground sm:text-4xl">
            Trace every hop{" "}
            <span className="text-gradient-brand">before it costs you a conversion</span>
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-[15px]">
            Real requests run server-side and follow every mechanism: HTTP redirects, meta refresh,
            JavaScript navigation and cloaked affiliate hops — with status codes, timings, headers,
            protocol changes and query-parameter diffs for each hop.
          </p>
        </section>

        <UrlInputPanel
          loading={mutation.isPending}
          initialUrl={initialUrl}
          onAnalyze={(urls, userAgent) => mutation.mutate({ urls, userAgent })}
          onClear={() => {
            setResults([]);
            setShareIds({});
            setInitialUrl("");
            mutation.reset();
          }}
          onDemo={() => {
            mutation.reset();
            setShareIds({});
            setResults(demoAnalysis());
            toast.message("Demo data loaded", {
              description: "Illustrative chain, not a live request.",
            });
          }}
        />

        {recentTraces.length > 0 && results.length === 0 && !mutation.isPending ? (
          <section aria-label="Recent traces" className="panel animate-rise p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                <History className="size-3.5 text-brand" />
                Recent traces ({recentTraces.length})
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearRecentTraces}
                className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <Trash2 className="size-3" />
                Clear history
              </Button>
            </div>
            <ul className="mt-3 divide-y divide-hairline">
              {recentTraces.map((item) => (
                <li
                  key={`${item.startUrl}-${item.analyzedAt}`}
                  className="flex flex-col gap-2 py-2.5 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {item.finalStatus ? <StatusBadge status={item.finalStatus} /> : null}
                      <span className="truncate font-mono text-xs font-medium text-foreground">
                        {item.startUrl}
                      </span>
                    </div>
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground">
                      <span>
                        {item.totalRedirects} redirect{item.totalRedirects === 1 ? "" : "s"}
                      </span>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="size-2.5" /> {item.totalResponseTimeMs} ms
                      </span>
                      {item.userAgentLabel ? (
                        <>
                          <span>·</span>
                          <span>{item.userAgentLabel}</span>
                        </>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      type="button"
                      variant="subtle"
                      size="sm"
                      onClick={() => setResults([item])}
                    >
                      View cached
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setInitialUrl(item.startUrl);
                        mutation.mutate({
                          urls: [item.startUrl],
                          userAgent: item.userAgentPreset ?? "desktop-chrome",
                        });
                      }}
                    >
                      <Play className="size-3" />
                      Re-trace
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {mutation.isPending ? (
          <LoadingState
            urls={mutation.variables?.urls}
            userAgentLabel={
              mutation.variables?.userAgent
                ? USER_AGENT_PRESETS[mutation.variables.userAgent]?.label
                : USER_AGENT_PRESETS["desktop-chrome"].label
            }
          />
        ) : null}

        {!mutation.isPending && mutation.isError ? (
          <ErrorState message={(mutation.error as Error)?.message ?? "Unknown error"} />
        ) : null}

        {!mutation.isPending && !mutation.isError && results.length === 0 ? <EmptyState /> : null}

        {!mutation.isPending && results.length > 1 ? (
          <div className="panel animate-rise grid grid-cols-1 items-center gap-3 p-3 sm:flex sm:justify-between">
            <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
              <Activity className="size-4 shrink-0 text-brand" />
              {results.length} chains analyzed
            </span>
            <ExportBar results={results} />
          </div>
        ) : null}

        {!mutation.isPending
          ? results.map((result) => (
              <ReportView
                key={`${result.startUrl}-${result.analyzedAt}`}
                result={result}
                shareId={shareIds[analysisKey(result)]}
              />
            ))
          : null}

        {/* Scheduled Redirect Drift & Uptime Monitor */}
        <RedirectMonitorPanel activeResults={results} />

        {/* One-Click Browser Bookmarklet & Chrome Extension Companion */}
        <BrowserExtensionPanel />

        {/* Crawlable Technical SEO & Affiliate Forensics Reference */}
        <section aria-labelledby="seo-guide-heading" className="panel space-y-5 p-5 sm:p-7">
          <div className="space-y-1.5">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.09em] text-brand">
              <BookOpen className="size-3.5" />
              Technical SEO & Affiliate Engineering Guide
            </span>
            <h2
              id="seo-guide-heading"
              className="text-lg font-semibold tracking-tight text-foreground sm:text-xl"
            >
              How server-side redirect chain auditing protects rankings and attribution
            </h2>
            <p className="text-xs leading-relaxed text-muted-foreground sm:text-sm">
              Search engine crawlers and performance marketing funnels depend on clean,
              deterministic HTTP forwarding. Inspecting every hop server-side reveals hidden status
              codes, header policies, and parameter mutations before they degrade organic visibility
              or paid ROAS.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <article className="rounded-xl border border-hairline bg-surface/60 p-4">
              <h3 className="font-mono text-xs font-semibold text-foreground">
                301 / 308 vs 302 / 307 Authority
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                Permanent redirects (301, 308) consolidate link equity and canonical signals at the
                destination URL. Accidental temporary redirects (302, 307) or client-side meta/JS
                hops split ranking signals and delay index consolidation.
              </p>
            </article>
            <article className="rounded-xl border border-hairline bg-surface/60 p-4">
              <h3 className="font-mono text-xs font-semibold text-foreground">
                UTM & Click-ID Preservation
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                Cross-domain redirects and trailing-slash normalizations frequently drop{" "}
                <code className="font-mono text-[11px]">gclid</code>,{" "}
                <code className="font-mono text-[11px]">fbclid</code>,{" "}
                <code className="font-mono text-[11px]">click_id</code>, and{" "}
                <code className="font-mono text-[11px]">utm_*</code> parameters, breaking analytics
                and affiliate conversion postbacks.
              </p>
            </article>
            <article className="rounded-xl border border-hairline bg-surface/60 p-4">
              <h3 className="font-mono text-xs font-semibold text-foreground">
                Bot Cloaking & HSTS Security
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                Comparing Googlebot Smartphone against Desktop and Mobile User-Agents uncovers
                conditional routing, while HSTS (
                <code className="font-mono text-[11px]">Strict-Transport-Security</code>) and{" "}
                <code className="font-mono text-[11px]">X-Robots-Tag</code> checks prevent protocol
                downgrades and silent de-indexing.
              </p>
            </article>
          </div>

          <div className="space-y-2 border-t border-hairline pt-4">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              <HelpCircle className="size-3.5 text-brand" />
              Frequently Asked Questions
            </h3>
            <div className="divide-y divide-hairline rounded-xl border border-hairline bg-surface/40">
              {SEO_FAQS.map((item) => (
                <details key={item.q} className="group p-3.5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-semibold text-foreground sm:text-[13px]">
                    <span>{item.q}</span>
                    <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                  </summary>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <footer className="space-y-2 border-t border-hairline pt-4 text-center font-mono text-[11px] leading-relaxed text-muted-foreground">
          <p>
            Requests run server-side behind SSRF, WAF &amp; DDoS burst protection with multi-user
            concurrency throttling, a 20-hop limit, a 15 s per-hop timeout and a 55 s overall
            budget.
          </p>
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
