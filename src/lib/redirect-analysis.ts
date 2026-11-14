import type {
  AnalysisIssue,
  HopParamDiff,
  ParamChange,
  RedirectAnalysis,
  RedirectHop,
  SeoInfo,
  TrackingReport,
  UserAgentPreset,
} from "./redirect-types";

export const MAX_HOPS = 20;
export const SLOW_HOP_MS = 1500;

export const USER_AGENT_PRESETS: Record<
  UserAgentPreset,
  {
    label: string;
    shortLabel: string;
    ua: string;
    secChUa?: string;
    secChUaMobile?: string;
    secChUaPlatform?: string;
  }
> = {
  "desktop-chrome": {
    label: "Desktop Chrome (Windows)",
    shortLabel: "Desktop Chrome",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    secChUa: '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    secChUaMobile: "?0",
    secChUaPlatform: '"Windows"',
  },
  "mobile-iphone": {
    label: "Mobile Safari (iPhone iOS)",
    shortLabel: "iPhone iOS",
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
    secChUaMobile: "?1",
    secChUaPlatform: '"iOS"',
  },
  "mobile-android": {
    label: "Mobile Chrome (Android Pixel)",
    shortLabel: "Android Chrome",
    ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
    secChUa: '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    secChUaMobile: "?1",
    secChUaPlatform: '"Android"',
  },
  "googlebot-smartphone": {
    label: "Googlebot Smartphone",
    shortLabel: "Googlebot Mobile",
    ua: "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  },
  "googlebot-desktop": {
    label: "Googlebot Desktop",
    shortLabel: "Googlebot Desktop",
    ua: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  },
  "social-bot": {
    label: "Social Link Preview Bot (Facebook / X / LinkedIn)",
    shortLabel: "Social Preview Bot",
    ua: "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php) Twitterbot/1.0",
  },
};

const TRACKING_PARAMS = new Set([
  "click_id",
  "clickid",
  "aff_id",
  "affid",
  "affiliate_id",
  "offer_id",
  "transaction_id",
  "gclid",
  "fbclid",
  "msclkid",
  "ttclid",
  "twclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  ...Array.from({ length: 10 }, (_, i) => `sub${i + 1}`),
]);

export function isTrackingParam(name: string): boolean {
  const key = name.toLowerCase();
  return TRACKING_PARAMS.has(key) || key.startsWith("utm_");
}

/** Strips all known affiliate/UTM tracking query parameters from a URL. */
export function stripTrackingParams(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const toDelete: string[] = [];
    u.searchParams.forEach((_, key) => {
      if (isTrackingParam(key)) toDelete.push(key);
    });
    for (const k of toDelete) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return rawUrl;
  }
}

export function redirectTypeLabel(status: number): string {
  switch (status) {
    case 301:
      return "Permanent Redirect";
    case 302:
      return "Found (Temporary)";
    case 303:
      return "See Other";
    case 307:
      return "Temporary Redirect";
    case 308:
      return "Permanent Redirect";
    default:
      if (status >= 300 && status < 400) return "Redirect";
      if (status >= 200 && status < 300) return "Success";
      if (status >= 400 && status < 500) return "Client Error";
      if (status >= 500) return "Server Error";
      return "Unknown";
  }
}

export function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

/** Mechanisms that move the chain forward, whatever the status code was. */
const REDIRECTING_MECHANISMS = new Set([
  "http-redirect",
  "javascript-redirect",
  "meta-refresh",
  "form-redirect",
  "gateway-unwrap",
  "browser-navigation",
]);

/** True when this hop hands off to another URL (HTTP or client-side). */
function hopRedirects(hop: RedirectHop): boolean {
  if (hop.mechanism) return REDIRECTING_MECHANISMS.has(hop.mechanism);
  return isRedirect(hop.status);
}

export function countRedirects(hops: RedirectHop[]): number {
  return hops.filter(hopRedirects).length;
}

export function protocolOf(url: string): "http" | "https" | "other" {
  if (url.startsWith("https:")) return "https";
  if (url.startsWith("http:")) return "http";
  return "other";
}

export function paramsOf(url: string): Record<string, string> {
  try {
    const out: Record<string, string> = {};
    new URL(url).searchParams.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  } catch {
    return {};
  }
}

export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function diffParams(from: RedirectHop, to: RedirectHop): HopParamDiff {
  const changes: ParamChange[] = [];
  const keys = new Set([...Object.keys(from.params), ...Object.keys(to.params)]);
  for (const key of Array.from(keys).sort()) {
    const before = from.params[key] ?? null;
    const after = to.params[key] ?? null;
    if (before === after) continue;
    const kind = before === null ? "added" : after === null ? "removed" : "modified";
    changes.push({ param: key, kind, from: before, to: after, tracking: isTrackingParam(key) });
  }
  return {
    fromIndex: from.index,
    toIndex: to.index,
    fromUrl: from.url,
    toUrl: to.url,
    changes,
  };
}

export function buildTrackingReport(hops: RedirectHop[]): TrackingReport {
  const diffs: HopParamDiff[] = [];
  for (let i = 1; i < hops.length; i += 1) {
    const diff = diffParams(hops[i - 1]!, hops[i]!);
    if (diff.changes.length) diffs.push(diff);
  }
  const startParams = hops[0]?.params ?? {};
  const finalParams = hops[hops.length - 1]?.params ?? {};
  const startTracking = Object.keys(startParams).filter(isTrackingParam);
  const lostTrackingParams = startTracking.filter((k) => !(k in finalParams));
  const keptTrackingParams = startTracking.filter((k) => k in finalParams);
  return { diffs, startParams, finalParams, lostTrackingParams, keptTrackingParams };
}

function normalizeComparableUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    if (u.pathname !== "/") u.pathname = u.pathname.replace(/\/+$/, "");
    return u.toString();
  } catch {
    return raw.trim().replace(/\/+$/, "");
  }
}

function buildIssues(
  hops: RedirectHop[],
  opts: {
    redirectLoop: boolean;
    truncated: boolean;
    tracking: TrackingReport;
    page?: { canonical: string | null; metaRobots: string | null };
    error?: string | null;
  },
): AnalysisIssue[] {
  const issues: AnalysisIssue[] = [];
  const push = (i: AnalysisIssue) => issues.push(i);

  if (opts.error) {
    push({ id: "request-failed", level: "error", title: "Request failed", detail: opts.error });
  }
  if (opts.redirectLoop) {
    push({
      id: "loop",
      level: "error",
      title: "Redirect loop detected",
      detail: "A URL in this chain redirects back to a URL already visited.",
    });
  }
  if (opts.truncated) {
    push({
      id: "too-many",
      level: "error",
      title: "Too many redirects",
      detail: `The chain exceeded the limit of ${MAX_HOPS} hops.`,
    });
  }

  hops.forEach((hop) => {
    if (hop.mechanism === "blocked") {
      push({
        id: `blocked-${hop.index}`,
        level: "error",
        title: "Destination blocked for safety",
        detail:
          hop.blockedReason ?? "This destination failed the safety check and was not requested.",
        hopIndex: hop.index,
      });
    }
    if (hop.mechanism === "unresolved") {
      push({
        id: `unresolved-${hop.index}`,
        level: "warning",
        title: "Client-side redirect could not be followed",
        detail:
          hop.blockedReason ??
          "A navigation was detected but its destination could not be resolved.",
        hopIndex: hop.index,
      });
    }
    if (
      hop.mechanism === "javascript-redirect" ||
      hop.mechanism === "meta-refresh" ||
      hop.mechanism === "form-redirect" ||
      hop.mechanism === "gateway-unwrap"
    ) {
      const titleMap: Record<string, string> = {
        "meta-refresh": "Meta refresh redirect",
        "javascript-redirect": hop.forensics?.deobfuscationSteps?.length
          ? "De-obfuscated JavaScript redirect"
          : "JavaScript redirect inside a 200 response",
        "form-redirect": "Auto-submitted HTML <form> redirect",
        "gateway-unwrap": "Unwrapped nested gateway / encoded redirect parameter",
      };
      push({
        id: `client-redirect-${hop.index}`,
        level: "info",
        title: titleMap[hop.mechanism] ?? "Client-side redirect",
        detail: `${hop.url} → ${hop.nextUrl ?? "unknown"}${hop.mechanismDetail ? ` (${hop.mechanismDetail})` : ""}`,
        hopIndex: hop.index,
      });
    }
    if (hop.mechanism === "browser-navigation") {
      push({
        id: `browser-nav-${hop.index}`,
        level: "info",
        title: "Resolved with a headless browser",
        detail: `${hop.url} navigated to ${hop.nextUrl ?? "unknown"} only after scripts ran.`,
        hopIndex: hop.index,
      });
    }

    if (isRedirect(hop.status) && !hop.location) {
      push({
        id: `missing-location-${hop.index}`,
        level: "error",
        title: "Missing Location header",
        detail: `Hop ${hop.index + 1} returned ${hop.status} without a Location header (broken redirect).`,
        hopIndex: hop.index,
      });
    }
    if (hop.status >= 500 && hop.mechanism !== "gateway-unwrap") {
      push({
        id: `server-error-${hop.index}`,
        level: "error",
        title: `${hop.status} server error`,
        detail: `${hop.url} responded with ${hop.status} ${hop.statusText}${hop.blockedReason ? ` — ${hop.blockedReason}` : "."}`,
        hopIndex: hop.index,
      });
    } else if (hop.status >= 400 && hop.mechanism !== "gateway-unwrap") {
      push({
        id: `client-error-${hop.index}`,
        level: "error",
        title: `${hop.status} client error`,
        detail: `${hop.url} responded with ${hop.status} ${hop.statusText}${hop.blockedReason ? ` — ${hop.blockedReason}` : "."}`,
        hopIndex: hop.index,
      });
    }
    if (hop.responseTimeMs > SLOW_HOP_MS) {
      push({
        id: `slow-${hop.index}`,
        level: "warning",
        title: "Slow redirect",
        detail: `Hop ${hop.index + 1} took ${hop.responseTimeMs} ms.`,
        hopIndex: hop.index,
      });
    }
    if (isRedirect(hop.status)) {
      push({
        id: `status-${hop.index}`,
        level: "info",
        title: `${hop.status} ${redirectTypeLabel(hop.status)}`,
        detail: `${hop.url} → ${hop.resolvedLocation ?? hop.location ?? "unknown"}`,
        hopIndex: hop.index,
      });
    }
    const next = hops[hop.index + 1];
    if (next) {
      if (hop.protocol === "http" && next.protocol === "https") {
        push({
          id: `upgrade-${hop.index}`,
          level: "info",
          title: "HTTP → HTTPS upgrade",
          detail: `Hop ${hop.index + 1} upgrades the connection to HTTPS.`,
          hopIndex: hop.index,
        });
      }
      if (hop.protocol === "https" && next.protocol === "http") {
        push({
          id: `downgrade-${hop.index}`,
          level: "error",
          title: "HTTPS → HTTP downgrade",
          detail: `Hop ${hop.index + 1} drops from HTTPS to insecure HTTP.`,
          hopIndex: hop.index,
        });
      }
    }
  });

  const redirects = countRedirects(hops);
  if (redirects >= 3 && !opts.truncated) {
    push({
      id: "long-chain",
      level: "warning",
      title: "Long redirect chain",
      detail: `${redirects} redirects before the final response. Aim for one hop maximum.`,
    });
  }

  if (opts.tracking.lostTrackingParams.length) {
    push({
      id: "tracking-lost",
      level: "warning",
      title: "Tracking parameters lost",
      detail: `Dropped during the chain: ${opts.tracking.lostTrackingParams.join(", ")}.`,
    });
  }

  const finalHop = hops[hops.length - 1];
  if (finalHop && opts.page?.canonical) {
    try {
      const resolvedCanon = new URL(opts.page.canonical, finalHop.url).toString();
      if (
        normalizeComparableUrl(resolvedCanon) !==
        normalizeComparableUrl(stripTrackingParams(finalHop.url))
      ) {
        push({
          id: "canonical-mismatch",
          level: "warning",
          title: "Canonical URL differs from final destination",
          detail: `Page declares canonical "${resolvedCanon}" while final URL is "${finalHop.url}".`,
        });
      }
    } catch {
      /* ignore malformed canonical */
    }
  }

  const xRobots = finalHop?.headers?.["x-robots-tag"] ?? null;
  const combinedRobots = `${opts.page?.metaRobots ?? ""} ${xRobots ?? ""}`.toLowerCase();
  if (combinedRobots.includes("noindex")) {
    push({
      id: "noindex-detected",
      level: "warning",
      title: "Destination blocks search indexing (noindex)",
      detail: `Final response includes a "noindex" directive (${xRobots ? `X-Robots-Tag: ${xRobots}` : `meta robots: ${opts.page?.metaRobots}`}).`,
    });
  }

  return issues;
}

export interface PageMetaInput {
  canonical: string | null;
  metaRobots: string | null;
  title?: string | null;
  description?: string | null;
  ogTitle?: string | null;
  ogDescription?: string | null;
  ogImage?: string | null;
  twitterCard?: string | null;
  hreflangCount?: number;
}

export function buildSeo(hops: RedirectHop[], page: PageMetaInput): SeoInfo {
  const final = hops[hops.length - 1];
  const finalUrl = final?.url ?? "";
  const cleanFinalUrl = finalUrl ? stripTrackingParams(finalUrl) : "";
  const xRobotsTag = final?.headers?.["x-robots-tag"] ?? null;
  const hsts = Boolean(final?.headers?.["strict-transport-security"]);
  const cacheControl = final?.headers?.["cache-control"] ?? null;
  const temporaryRedirectsCount = hops.filter(
    (h) =>
      h.status === 302 ||
      h.status === 307 ||
      h.mechanism === "meta-refresh" ||
      h.mechanism === "javascript-redirect",
  ).length;

  let canonicalStatus: "match" | "mismatch" | "missing" = "missing";
  if (page.canonical && finalUrl) {
    try {
      const resolvedCanon = new URL(page.canonical, finalUrl).toString();
      canonicalStatus =
        normalizeComparableUrl(resolvedCanon) === normalizeComparableUrl(cleanFinalUrl) ||
        normalizeComparableUrl(resolvedCanon) === normalizeComparableUrl(finalUrl)
          ? "match"
          : "mismatch";
    } catch {
      canonicalStatus = "mismatch";
    }
  }

  let resolvedOgImage = page.ogImage ?? null;
  if (resolvedOgImage && finalUrl) {
    try {
      resolvedOgImage = new URL(resolvedOgImage, finalUrl).toString();
    } catch {
      /* keep raw */
    }
  }

  return {
    finalStatus: final?.status ?? null,
    https: final ? final.protocol === "https" : false,
    canonical: page.canonical,
    metaRobots: page.metaRobots,
    chainLength: countRedirects(hops),
    xRobotsTag,
    hsts,
    cacheControl,
    canonicalStatus,
    temporaryRedirectsCount,
    cleanFinalUrl,
    title: page.title ?? null,
    description: page.description ?? null,
    ogTitle: page.ogTitle ?? null,
    ogDescription: page.ogDescription ?? null,
    ogImage: resolvedOgImage,
    twitterCard: page.twitterCard ?? null,
    hreflangCount: page.hreflangCount ?? 0,
  };
}

export function assemble(params: {
  startUrl: string;
  hops: RedirectHop[];
  redirectLoop: boolean;
  truncated: boolean;
  page: PageMetaInput;
  source: "live" | "demo";
  error?: string | null;
  userAgentPreset?: UserAgentPreset;
}): RedirectAnalysis {
  const { hops } = params;
  const tracking = buildTrackingReport(hops);
  const final = hops[hops.length - 1];
  const preset = params.userAgentPreset;
  return {
    startUrl: params.startUrl,
    hops,
    finalUrl: final?.url ?? params.startUrl,
    finalStatus: final?.status ?? null,
    totalHops: hops.length,
    totalRedirects: countRedirects(hops),
    totalResponseTimeMs: hops.reduce((sum, h) => sum + h.responseTimeMs, 0),
    redirectLoop: params.redirectLoop,
    seo: buildSeo(hops, params.page),
    issues: buildIssues(hops, {
      redirectLoop: params.redirectLoop,
      truncated: params.truncated,
      tracking,
      page: params.page,
      error: params.error ?? null,
    }),
    tracking,
    source: params.source,
    analyzedAt: new Date().toISOString(),
    error: params.error ?? null,
    ...(preset
      ? {
          userAgentPreset: preset,
          userAgentLabel:
            USER_AGENT_PRESETS[preset]?.label ?? USER_AGENT_PRESETS["desktop-chrome"].label,
        }
      : {}),
  };
}
