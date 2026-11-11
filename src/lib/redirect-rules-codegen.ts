import { stripTrackingParams } from "./redirect-analysis";
import type { RedirectAnalysis } from "./redirect-types";

export type ServerPlatform =
  "nginx" | "apache" | "cloudflare" | "cloudflare-worker" | "wordpress" | "vercel" | "netlify";

export interface GeneratedRedirectRules {
  sourceUrl: string;
  sourcePath: string;
  sourceHost: string;
  targetUrl: string;
  cleanTargetUrl: string;
  hopsSaved: number;
  needsConsolidation: boolean;
  reason: string;
  snippets: Record<ServerPlatform, { label: string; filename: string; code: string }>;
}

function safeParseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function escapeRegexPath(path: string): string {
  return path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Generates copy-pasteable 301 permanent redirect rules across 7 server/edge/CMS
 * platforms to collapse multi-hop chains or convert temporary 302/307/JS hops
 * into a single direct 301 hop.
 */
export function generateServerRedirectRules(result: RedirectAnalysis): GeneratedRedirectRules {
  const startParsed = safeParseUrl(result.startUrl);
  const finalUrl = result.finalUrl || result.startUrl;
  const cleanTargetUrl = result.seo.cleanFinalUrl || stripTrackingParams(finalUrl) || finalUrl;

  const sourceHost = startParsed?.host ?? "example.com";
  const sourcePath = startParsed?.pathname || "/";
  const hopsSaved = Math.max(0, result.totalRedirects - 1);
  const hasTempRedirects = (result.seo.temporaryRedirectsCount ?? 0) > 0;
  const needsConsolidation = result.totalRedirects > 1 || hasTempRedirects;

  const reason =
    result.totalRedirects > 1
      ? `Collapses ${result.totalRedirects} redirect hops into 1 direct 301 permanent hop (saves ${hopsSaved} round-trip${hopsSaved === 1 ? "" : "s"}).`
      : hasTempRedirects
        ? "Upgrades temporary (302/307/client) forwarding to a permanent 301 server redirect to consolidate SEO link equity."
        : "Direct 301 rule template from the analyzed source path to its canonical destination.";

  const escapedApachePath = escapeRegexPath(sourcePath.replace(/^\/+/, ""));
  const nginxExactPath = sourcePath === "/" ? "= /" : `= ${sourcePath}`;

  const nginxCode = [
    `# Nginx — Direct 301 redirect (${sourceHost})`,
    `location ${nginxExactPath} {`,
    `    return 301 ${finalUrl};`,
    `}`,
  ].join("\n");

  const apacheCode = [
    `# Apache (.htaccess) — Direct 301 redirect`,
    `RewriteEngine On`,
    `RewriteCond %{HTTP_HOST} ^${escapeRegexPath(sourceHost)}$ [NC]`,
    `RewriteRule ^${escapedApachePath}/?$ ${finalUrl} [R=301,L]`,
  ].join("\n");

  const cloudflareCode = JSON.stringify(
    [
      {
        source_url: `${sourceHost}${sourcePath}`,
        target_url: finalUrl,
        status_code: 301,
        preserve_query_string: true,
        include_subdomains: false,
        subpath_matching: false,
      },
    ],
    null,
    2,
  );

  const cloudflareWorkerCode = [
    `// Cloudflare Worker (worker.js) — Edge 301 Redirect Consolidation`,
    `const REDIRECT_MAP = new Map([`,
    `  [${JSON.stringify(sourcePath)}, ${JSON.stringify(finalUrl)}],`,
    `]);`,
    ``,
    `export default {`,
    `  async fetch(request) {`,
    `    const url = new URL(request.url);`,
    `    const target = REDIRECT_MAP.get(url.pathname);`,
    `    if (target) {`,
    `      return Response.redirect(target, 301);`,
    `    }`,
    `    return fetch(request);`,
    `  },`,
    `};`,
  ].join("\n");

  const wordpressCode = [
    `<?php`,
    `// WordPress (functions.php or mu-plugin) — Direct 301 Redirect`,
    `add_action('template_redirect', function () {`,
    `    $req_path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);`,
    `    if ($req_path === ${JSON.stringify(sourcePath)}) {`,
    `        wp_redirect(${JSON.stringify(finalUrl)}, 301, 'CROSX-Redirect-Consolidator');`,
    `        exit;`,
    `    }`,
    `});`,
  ].join("\n");

  const vercelCode = JSON.stringify(
    {
      redirects: [
        {
          source: sourcePath,
          destination: finalUrl,
          permanent: true,
        },
      ],
    },
    null,
    2,
  );

  const netlifyCode = [`# Netlify (_redirects)`, `${sourcePath}  ${finalUrl}  301!`].join("\n");

  return {
    sourceUrl: result.startUrl,
    sourcePath,
    sourceHost,
    targetUrl: finalUrl,
    cleanTargetUrl,
    hopsSaved,
    needsConsolidation,
    reason,
    snippets: {
      nginx: { label: "Nginx", filename: "nginx.conf", code: nginxCode },
      apache: { label: "Apache (.htaccess)", filename: ".htaccess", code: apacheCode },
      cloudflare: {
        label: "Cloudflare Bulk JSON",
        filename: "cloudflare-redirects.json",
        code: cloudflareCode,
      },
      "cloudflare-worker": {
        label: "Cloudflare Worker",
        filename: "worker.js",
        code: cloudflareWorkerCode,
      },
      wordpress: {
        label: "WordPress (PHP)",
        filename: "crosx-redirects.php",
        code: wordpressCode,
      },
      vercel: { label: "Vercel", filename: "vercel.json", code: vercelCode },
      netlify: { label: "Netlify", filename: "_redirects", code: netlifyCode },
    },
  };
}

/**
 * Generates a consolidated multi-rule `.htaccess` or `nginx.conf` file for an entire
 * batch of analyzed URLs (e.g. from a Sitemap or migration audit).
 */
export function generateBatchConsolidatedRules(
  results: RedirectAnalysis[],
  format: "nginx" | "apache" | "cloudflare-worker",
): string {
  if (format === "nginx") {
    return [
      `# Consolidated Nginx 301 Redirect Rules — Generated by CROSX (https://rca.crosx.in)`,
      ...results.map((r) => generateServerRedirectRules(r).snippets.nginx.code),
    ].join("\n\n");
  }
  if (format === "cloudflare-worker") {
    const entries = results
      .map((r) => {
        const g = generateServerRedirectRules(r);
        return `  [${JSON.stringify(g.sourcePath)}, ${JSON.stringify(g.targetUrl)}],`;
      })
      .join("\n");
    return [
      `// Consolidated Cloudflare Worker (worker.js) — Generated by CROSX (https://rca.crosx.in)`,
      `const REDIRECT_MAP = new Map([`,
      entries,
      `]);`,
      ``,
      `export default {`,
      `  async fetch(request) {`,
      `    const url = new URL(request.url);`,
      `    const target = REDIRECT_MAP.get(url.pathname);`,
      `    if (target) return Response.redirect(target, 301);`,
      `    return fetch(request);`,
      `  },`,
      `};`,
    ].join("\n");
  }
  return [
    `# Consolidated Apache (.htaccess) 301 Redirect Rules — Generated by CROSX (https://rca.crosx.in)`,
    `RewriteEngine On`,
    ...results.map((r) => {
      const g = generateServerRedirectRules(r);
      const escapedApachePath = escapeRegexPath(g.sourcePath.replace(/^\/+/, ""));
      return `RewriteRule ^${escapedApachePath}/?$ ${g.targetUrl} [R=301,L]`;
    }),
  ].join("\n");
}

export interface AgentComparisonEntry {
  preset: string;
  label: string;
  finalUrl: string;
  cleanFinalUrl: string;
  finalStatus: number | null;
  totalRedirects: number;
  totalResponseTimeMs: number;
  https: boolean;
  canonical: string | null;
  mechanisms: string[];
}

export interface CloakingVerdict {
  cloakingDetected: boolean;
  mobileDivergence: boolean;
  statusDivergence: boolean;
  hopCountDivergence: boolean;
  severity: "clean" | "warning" | "critical";
  summary: string;
  findings: string[];
  entries: AgentComparisonEntry[];
}

function normalizeUrlForCloaking(raw: string): string {
  try {
    const u = new URL(stripTrackingParams(raw));
    u.hash = "";
    if (u.pathname !== "/") u.pathname = u.pathname.replace(/\/+$/, "");
    return u.toString().toLowerCase();
  } catch {
    return raw.trim().toLowerCase();
  }
}

/**
 * Compares redirect chains across multiple User-Agent profiles (e.g. Desktop,
 * iPhone Mobile, and Googlebot Smartphone) to detect SEO cloaking or conditional
 * mobile routing.
 */
export function evaluateCloakingMatrix(analyses: RedirectAnalysis[]): CloakingVerdict {
  const entries: AgentComparisonEntry[] = analyses.map((a) => ({
    preset: a.userAgentPreset ?? "desktop-chrome",
    label: a.userAgentLabel ?? "Desktop Chrome",
    finalUrl: a.finalUrl,
    cleanFinalUrl: a.seo.cleanFinalUrl ?? stripTrackingParams(a.finalUrl),
    finalStatus: a.finalStatus,
    totalRedirects: a.totalRedirects,
    totalResponseTimeMs: a.totalResponseTimeMs,
    https: a.seo.https,
    canonical: a.seo.canonical,
    mechanisms: Array.from(
      new Set(
        a.hops
          .filter((h) => h.mechanism && h.mechanism !== "final-response")
          .map((h) => h.mechanismLabel ?? h.redirectType),
      ),
    ),
  }));

  if (entries.length < 2) {
    return {
      cloakingDetected: false,
      mobileDivergence: false,
      statusDivergence: false,
      hopCountDivergence: false,
      severity: "clean",
      summary: "Run at least two User-Agent profiles to compare routing behavior.",
      findings: [],
      entries,
    };
  }

  const desktop = entries.find((e) => e.preset === "desktop-chrome") ?? entries[0]!;
  const mobile = entries.find((e) => e.preset.startsWith("mobile-"));
  const googlebot = entries.find((e) => e.preset.startsWith("googlebot-"));

  const findings: string[] = [];
  let cloakingDetected = false;
  let mobileDivergence = false;

  if (
    googlebot &&
    normalizeUrlForCloaking(googlebot.cleanFinalUrl) !==
      normalizeUrlForCloaking(desktop.cleanFinalUrl)
  ) {
    cloakingDetected = true;
    findings.push(
      `Googlebot lands on "${googlebot.cleanFinalUrl}" while Desktop Chrome lands on "${desktop.cleanFinalUrl}".`,
    );
  }

  if (
    googlebot &&
    mobile &&
    normalizeUrlForCloaking(googlebot.cleanFinalUrl) !==
      normalizeUrlForCloaking(mobile.cleanFinalUrl)
  ) {
    cloakingDetected = true;
    findings.push(
      `Googlebot lands on "${googlebot.cleanFinalUrl}" while Mobile users are routed to "${mobile.cleanFinalUrl}".`,
    );
  }

  if (
    mobile &&
    normalizeUrlForCloaking(mobile.cleanFinalUrl) !== normalizeUrlForCloaking(desktop.cleanFinalUrl)
  ) {
    mobileDivergence = true;
    findings.push(
      `Mobile visitors are redirected to "${mobile.cleanFinalUrl}" instead of Desktop destination "${desktop.cleanFinalUrl}".`,
    );
  }

  const uniqueStatuses = new Set(entries.map((e) => e.finalStatus));
  const statusDivergence = uniqueStatuses.size > 1;
  if (statusDivergence) {
    findings.push(
      `Final HTTP status differs across User-Agents (${entries.map((e) => `${e.label}: ${e.finalStatus ?? "ERR"}`).join(", ")}).`,
    );
  }

  const uniqueHops = new Set(entries.map((e) => e.totalRedirects));
  const hopCountDivergence = uniqueHops.size > 1;
  if (hopCountDivergence) {
    findings.push(
      `Redirect hop count varies by User-Agent (${entries.map((e) => `${e.label}: ${e.totalRedirects} hop${e.totalRedirects === 1 ? "" : "s"}`).join(", ")}).`,
    );
  }

  const severity: "clean" | "warning" | "critical" = cloakingDetected
    ? "critical"
    : mobileDivergence || statusDivergence || hopCountDivergence
      ? "warning"
      : "clean";

  const summary =
    severity === "critical"
      ? "Potential SEO cloaking detected: Googlebot receives a different destination URL than human visitors."
      : severity === "warning"
        ? "Conditional User-Agent routing detected: hop count, status, or mobile destination varies by profile."
        : "Consistent routing verified: Desktop, Mobile, and Googlebot resolve to the exact same canonical destination.";

  return {
    cloakingDetected,
    mobileDivergence,
    statusDivergence,
    hopCountDivergence,
    severity,
    summary,
    findings,
    entries,
  };
}

export interface SeoAuditGrade {
  grade: "Pass" | "Warning" | "Critical";
  score: number;
  notes: string[];
}

/** Computes a deterministic SEO health grade (0–100) for bulk audit tables & CSV exports. */
export function gradeSeoAnalysis(result: RedirectAnalysis): SeoAuditGrade {
  let score = 100;
  const notes: string[] = [];

  if (result.error || result.redirectLoop || (result.finalStatus && result.finalStatus >= 400)) {
    score -= 60;
    notes.push(
      result.redirectLoop
        ? "Redirect loop"
        : result.finalStatus && result.finalStatus >= 400
          ? `HTTP ${result.finalStatus} error`
          : "Request failed",
    );
  }

  if (!result.seo.https) {
    score -= 25;
    notes.push("Insecure HTTP destination");
  }

  if (result.totalRedirects >= 3) {
    score -= 20;
    notes.push(`${result.totalRedirects} hops (long chain)`);
  } else if (result.totalRedirects === 2) {
    score -= 8;
    notes.push("2 redirect hops");
  }

  if ((result.seo.temporaryRedirectsCount ?? 0) > 0) {
    score -= 10;
    notes.push(`${result.seo.temporaryRedirectsCount} temporary/client hop(s)`);
  }

  if (!result.seo.hsts && result.seo.https) {
    score -= 5;
    notes.push("Missing HSTS header");
  }

  if (result.seo.canonicalStatus === "mismatch") {
    score -= 15;
    notes.push("Canonical URL mismatch");
  }

  if (result.tracking.lostTrackingParams.length > 0) {
    score -= 12;
    notes.push(`Dropped params: ${result.tracking.lostTrackingParams.join(", ")}`);
  }

  const clamped = Math.max(0, Math.min(100, score));
  const grade: "Pass" | "Warning" | "Critical" =
    clamped >= 85 ? "Pass" : clamped >= 60 ? "Warning" : "Critical";

  if (notes.length === 0) notes.push("Clean chain & indexable destination");

  return { grade, score: clamped, notes };
}

export interface UtmParams {
  source?: string;
  medium?: string;
  campaign?: string;
  term?: string;
  content?: string;
}

/** Appends or updates UTM query parameters on a destination URL while preserving existing query parameters. */
export function applyUtmParameters(rawUrl: string, utm: UtmParams): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";
  try {
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const u = new URL(withProto);
    const map: [string, string | undefined][] = [
      ["utm_source", utm.source],
      ["utm_medium", utm.medium],
      ["utm_campaign", utm.campaign],
      ["utm_term", utm.term],
      ["utm_content", utm.content],
    ];
    for (const [key, val] of map) {
      const v = val?.trim();
      if (v) {
        u.searchParams.set(key, v);
      }
    }
    return u.toString();
  } catch {
    return trimmed;
  }
}
