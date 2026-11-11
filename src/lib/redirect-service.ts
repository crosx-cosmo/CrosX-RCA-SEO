/**
 * API service layer.
 *
 * The UI never fabricates redirect data — it always goes through this layer.
 *
 * Resolution order:
 *  1. `VITE_REDIRECT_API_URL` — an external backend endpoint, if configured.
 *     Expected: POST { urls: string[] } -> RedirectAnalysis[]  (or a single object)
 *  2. The built-in server function, which performs the real HTTP requests.
 *  3. Demo mode (explicit user action only) for previewing the UI with no API.
 */
import {
  analyzeRedirectChain,
  analyzeRedirectChains,
  compareRedirectAgents,
} from "./redirect.functions";
import { buildDemoAnalysis } from "./redirect-demo";
import { normalizeUrl, USER_AGENT_PRESETS } from "./redirect-analysis";
import { saveAnalyses, type ShareIdMap } from "./analysis-store";
import type { RedirectAnalysis, UserAgentPreset } from "./redirect-types";

export interface AnalyzeOutcome {
  results: RedirectAnalysis[];
  shareIds: ShareIdMap;
}

const EXTERNAL_ENDPOINT = import.meta.env["VITE_REDIRECT_API_URL"] as string | undefined;

export function activeBackend(): "external" | "server-function" {
  return EXTERNAL_ENDPOINT ? "external" : "server-function";
}

async function callExternal(
  urls: string[],
  userAgent?: UserAgentPreset,
): Promise<RedirectAnalysis[]> {
  const response = await fetch(EXTERNAL_ENDPOINT!, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ urls, userAgent }),
  });
  if (!response.ok) {
    throw new Error(`Analyzer API responded with ${response.status}`);
  }
  const payload = await response.json();
  return Array.isArray(payload) ? payload : [payload];
}

export async function analyzeUrls(
  rawUrls: string[],
  userAgent: UserAgentPreset = "desktop-chrome",
): Promise<AnalyzeOutcome> {
  const urls = rawUrls.map(normalizeUrl).filter(Boolean);
  if (!urls.length) throw new Error("Enter at least one URL to analyze.");

  const results = EXTERNAL_ENDPOINT
    ? await callExternal(urls, userAgent)
    : urls.length === 1
      ? [await analyzeRedirectChain({ data: { url: urls[0]!, userAgent } })]
      : await analyzeRedirectChains({ data: { urls, userAgent } });

  // Saving powers shareable links; a slow or unreachable DB must never delay the analysis UI.
  const shareIds = await Promise.race([
    saveAnalyses(results).catch(() => ({}) as ShareIdMap),
    new Promise<ShareIdMap>((resolve) => setTimeout(() => resolve({}), 1500)),
  ]);
  return { results, shareIds };
}

export async function compareUrlAcrossAgents(
  rawUrl: string,
  isDemo = false,
): Promise<RedirectAnalysis[]> {
  const url = normalizeUrl(rawUrl);
  if (!url) throw new Error("Enter a URL to compare.");

  if (isDemo) {
    const base = buildDemoAnalysis(url);
    const profiles: UserAgentPreset[] = ["desktop-chrome", "mobile-iphone", "googlebot-smartphone"];
    return profiles.map((preset) => ({
      ...base,
      userAgentPreset: preset,
      userAgentLabel: USER_AGENT_PRESETS[preset].label,
      totalResponseTimeMs:
        preset === "googlebot-smartphone"
          ? Math.max(120, base.totalResponseTimeMs - 140)
          : preset === "mobile-iphone"
            ? base.totalResponseTimeMs + 85
            : base.totalResponseTimeMs,
    }));
  }

  return compareRedirectAgents({ data: { url } });
}

export function demoAnalysis(): RedirectAnalysis[] {
  return [buildDemoAnalysis("http://demo-offer.example/go?click_id=abc123&aff_id=5541")];
}
