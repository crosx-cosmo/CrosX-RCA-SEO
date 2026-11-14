/**
 * Universal redirect + URL trace engine (server-only).
 *
 * Traces a URL through every redirect mechanism it can safely follow:
 *  - HTTP 301/302/303/307/308 (and any 3xx with a Location header)
 *  - Extended redirect headers (Refresh, HX-Redirect, X-Redirect, X-Redirect-To)
 *  - HTML meta refresh
 *  - Direct & de-obfuscated JavaScript location navigation (Base64, Hex, Unicode,
 *    String.fromCharCode, variable indirection, reversed strings, setTimeout)
 *  - Auto-submitted HTML <form action="..."> redirects
 *  - Next.js / SPA hydration state & thin interstitial anchors
 *  - Nested query-parameter & link-shim gateway unwrapping (Base64, Hex, URL-encoded,
 *    Proofpoint v3, SafeLinks, Facebook/Google/YouTube/AMP wrappers)
 *  - Computed/dynamic navigation, via an isolated headless-browser fallback
 *
 * Stateful across hops:
 *  - Maintains an in-memory per-trace Cookie Jar (Set-Cookie -> Cookie)
 *  - Propagates Referer headers across hops (respecting Referrer-Policy)
 *  - Records deep forensic telemetry on every hop
 */
import {
  assemble,
  isRedirect,
  normalizeUrl,
  paramsOf,
  protocolOf,
  redirectTypeLabel,
  USER_AGENT_PRESETS,
} from "./redirect-analysis";
import {
  detectClientRedirect,
  extractEmbeddedTargets,
  extractJsonRedirectTarget,
  extractPageMeta,
  extractUpstreamBlockReason,
  isOsOrDeviceRejectionMessage,
  looksLikeRedirector,
  parseRefreshValue,
} from "./trace-detect";
import { assertSafeUrl, readBoundedText } from "./trace-ssrf.server";
import { browserFallbackConfigured, traceWithBrowser } from "./trace-browser.server";
import type {
  HopCookieInfo,
  HopForensics,
  HopMechanism,
  RedirectAnalysis,
  RedirectHop,
  UserAgentPreset,
} from "./redirect-types";

export const MAX_HOPS = 20;
const PER_HOP_TIMEOUT_MS = 15_000;
const OVERALL_TIMEOUT_MS = 55_000;
const MAX_BODY_BYTES = 2_000_000;

const MECHANISM_LABEL: Record<HopMechanism, string> = {
  "http-redirect": "HTTP Redirect",
  "javascript-redirect": "JavaScript Redirect",
  "meta-refresh": "Meta Refresh",
  "form-redirect": "Form Auto-Submit",
  "gateway-unwrap": "Gateway Unwrap",
  "browser-navigation": "Browser Navigation",
  "final-response": "Final Response",
  blocked: "Blocked",
  unresolved: "Not Followed",
  error: "Request Failed",
};

interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string | null;
}

/** Lightweight per-trace cookie jar so multi-hop affiliate & auth trackers don't drop sessions. */
const MAX_COOKIES_PER_TRACE = 50;
const MAX_COOKIE_VALUE_BYTES = 2048;

export class TraceCookieJar {
  private store = new Map<string, StoredCookie>();

  ingestSetCookieHeaders(rawCookies: string[], requestUrl: string): HopCookieInfo[] {
    const recorded: HopCookieInfo[] = [];
    let reqUrl: URL;
    try {
      reqUrl = new URL(requestUrl);
    } catch {
      return recorded;
    }

    for (const raw of rawCookies.slice(0, MAX_COOKIES_PER_TRACE)) {
      const parts = raw
        .split(";")
        .map((p) => p.trim())
        .filter(Boolean);
      if (parts.length === 0) continue;
      const first = parts[0]!;
      const eqIdx = first.indexOf("=");
      if (eqIdx <= 0) continue;

      const name = first
        .slice(0, eqIdx)
        .trim()
        .replace(/[\r\n\0;]/g, "")
        .slice(0, 128);
      const value = first
        .slice(eqIdx + 1)
        .trim()
        .replace(/[\r\n\0]/g, "")
        .slice(0, MAX_COOKIE_VALUE_BYTES);
      if (!name) continue;

      let domain = reqUrl.hostname.toLowerCase();
      let path = "/";
      let secure = false;
      let httpOnly = false;
      let sameSite: string | null = null;
      const flags: string[] = [];

      for (const attr of parts.slice(1)) {
        const [kRaw, vRaw] = attr.split("=");
        const k = (kRaw ?? "").trim().toLowerCase();
        const v = (vRaw ?? "").trim().replace(/[\r\n\0]/g, "");
        if (k === "domain" && v) {
          const cleanedDomain = v.replace(/^\.+/, "").toLowerCase();
          // Refuse single-label TLD cookie poisoning (e.g. Domain=.com)
          if (cleanedDomain.includes(".")) {
            domain = cleanedDomain;
            flags.push(`Domain=${domain}`);
          }
        } else if (k === "path" && v) {
          path = v.slice(0, 256);
        } else if (k === "secure") {
          secure = true;
          flags.push("Secure");
        } else if (k === "httponly") {
          httpOnly = true;
          flags.push("HttpOnly");
        } else if (k === "samesite" && v) {
          sameSite = v.slice(0, 32);
          flags.push(`SameSite=${sameSite}`);
        }
      }

      // Security check: only allow setting cookie for same host or parent domain
      const reqHost = reqUrl.hostname.toLowerCase();
      if (
        this.store.size < MAX_COOKIES_PER_TRACE &&
        (reqHost === domain || reqHost.endsWith(`.${domain}`))
      ) {
        this.store.set(`${domain}|${path}|${name}`, {
          name,
          value,
          domain,
          path,
          secure,
          httpOnly,
          sameSite,
        });
      }

      const preview = value.length > 24 ? `${value.slice(0, 21)}…` : value;
      recorded.push({ name, valuePreview: preview, flags });
    }

    return recorded;
  }

  getCookiesFor(requestUrl: string): { headerValue: string | null; names: string[] } {
    let reqUrl: URL;
    try {
      reqUrl = new URL(requestUrl);
    } catch {
      return { headerValue: null, names: [] };
    }

    const reqHost = reqUrl.hostname.toLowerCase();
    const isHttps = reqUrl.protocol === "https:";
    const pairs: string[] = [];
    const names: string[] = [];

    for (const cookie of this.store.values()) {
      if (cookie.secure && !isHttps) continue;
      const domainMatch = reqHost === cookie.domain || reqHost.endsWith(`.${cookie.domain}`);
      if (!domainMatch) continue;
      if (!reqUrl.pathname.startsWith(cookie.path)) continue;
      pairs.push(`${cookie.name}=${cookie.value}`);
      names.push(cookie.name);
    }

    return {
      headerValue: pairs.length > 0 ? pairs.join("; ") : null,
      names,
    };
  }
}

function extractRawSetCookies(headers: Headers): string[] {
  const anyHeaders = headers as unknown as { getSetCookie?: () => string[] };
  if (typeof anyHeaders.getSetCookie === "function") {
    const list = anyHeaders.getSetCookie();
    if (Array.isArray(list) && list.length > 0) return list;
  }
  const single = headers.get("set-cookie");
  if (!single) return [];
  // Split multiple Set-Cookie values while avoiding commas inside Expires=Wed, 21 Oct...
  return single.split(/,(?=\s*[A-Za-z0-9_-]+\s*=)/g).map((s) => s.trim());
}

function isLikelyGatewayOrWrapperUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase();
    const path = u.pathname.toLowerCase();
    if (
      /(?:facebook\.com|google\.|youtube\.com|safelinks\.protection\.outlook\.com|urldefense\.|t\.umblr\.com|vk\.com|steamcommunity\.com|out\.reddit\.com|l\.instagram\.com|away\.vk\.com|duckduckgo\.com|r\.search\.yahoo\.com|redirect\.|go\.|trk\.|click\.|links?\.)/i.test(
        host,
      )
    ) {
      return true;
    }
    if (
      /^\/(?:l\.php|url|redirect|out|go|r|exit|leave|click|track|away|external|jump|visit|link|v3\/__)/i.test(
        path,
      )
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

const OS_FALLBACK_ORDER: UserAgentPreset[] = ["mobile-android", "mobile-iphone", "desktop-chrome"];

function isSpecialBotPreset(preset: UserAgentPreset): boolean {
  return (
    preset === "googlebot-smartphone" || preset === "googlebot-desktop" || preset === "social-bot"
  );
}

export function buildHopRequestHeaders(
  presetKey: UserAgentPreset,
  cookieHeader: string | null,
  refererSent: string | null,
): Record<string, string> {
  const preset = USER_AGENT_PRESETS[presetKey] ?? USER_AGENT_PRESETS["desktop-chrome"];
  const headers: Record<string, string> = {
    "user-agent": preset.ua,
    accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,image/avif,image/webp,*/*;q=0.7",
    "accept-language": "en-US,en;q=0.9",
    "upgrade-insecure-requests": "1",
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": refererSent ? "cross-site" : "none",
    "sec-fetch-user": "?1",
  };
  if (preset.secChUa) headers["sec-ch-ua"] = preset.secChUa;
  if (preset.secChUaMobile) headers["sec-ch-ua-mobile"] = preset.secChUaMobile;
  if (preset.secChUaPlatform) headers["sec-ch-ua-platform"] = preset.secChUaPlatform;
  if (cookieHeader) headers["cookie"] = cookieHeader;
  if (refererSent) headers["referer"] = refererSent;
  return headers;
}

function isReadableBodyType(contentType: string): boolean {
  const ct = contentType.toLowerCase();
  return (
    ct === "" ||
    ct.includes("html") ||
    ct.includes("xhtml") ||
    ct.includes("json") ||
    ct.includes("javascript") ||
    ct.includes("ecmascript") ||
    ct.includes("text/plain") ||
    ct.includes("xml")
  );
}

async function readResponseTextSafe(res: Response): Promise<string> {
  const contentType = res.headers.get("content-type") ?? "";
  const contentLength = Number(res.headers.get("content-length") ?? "0");
  if (isReadableBodyType(contentType) && contentLength <= MAX_BODY_BYTES) {
    try {
      return await readBoundedText(res, 500_000);
    } catch {
      return "";
    }
  }
  await res.body?.cancel().catch(() => {});
  return "";
}

function headersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function canonicalKey(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString();
  } catch {
    return url;
  }
}

function resolveAgainst(base: string, target: string): string | null {
  try {
    return new URL(target, base).toString();
  } catch {
    return null;
  }
}

function computeNextReferer(
  fromUrl: string,
  toUrl: string,
  referrerPolicyHeader: string | null,
): string | null {
  const policy = (referrerPolicyHeader ?? "").toLowerCase();
  if (policy.includes("no-referrer") && !policy.includes("downgrade")) return null;
  try {
    const from = new URL(fromUrl);
    const to = new URL(toUrl);
    // Never send HTTPS referer over plain HTTP downgrade
    if (from.protocol === "https:" && to.protocol === "http:") return null;
    if (policy.includes("same-origin") && from.origin !== to.origin) return null;
    if (policy.includes("origin")) return `${from.origin}/`;
    return from.toString();
  } catch {
    return null;
  }
}

interface HopDraft extends RedirectHop {
  mechanism: HopMechanism;
  mechanismLabel: string;
  mechanismDetail: string | null;
  evidence: string | null;
  nextUrl: string | null;
  blockedReason: string | null;
  addresses: string[];
  forensics?: HopForensics;
}

function makeHop(
  partial: Partial<HopDraft> & { index: number; url: string; mechanism: HopMechanism },
): HopDraft {
  return {
    index: partial.index,
    url: partial.url,
    protocol: protocolOf(partial.url),
    status: partial.status ?? 0,
    statusText: partial.statusText ?? "",
    redirectType: partial.redirectType ?? MECHANISM_LABEL[partial.mechanism],
    responseTimeMs: partial.responseTimeMs ?? 0,
    location: partial.location ?? null,
    resolvedLocation: partial.resolvedLocation ?? null,
    server: partial.server ?? null,
    ip: partial.ip ?? null,
    headers: partial.headers ?? {},
    params: paramsOf(partial.url),
    mechanism: partial.mechanism,
    mechanismLabel: MECHANISM_LABEL[partial.mechanism],
    mechanismDetail: partial.mechanismDetail ?? null,
    evidence: partial.evidence ?? null,
    nextUrl: partial.nextUrl ?? null,
    blockedReason: partial.blockedReason ?? null,
    addresses: partial.addresses ?? [],
    ...(partial.forensics !== undefined ? { forensics: partial.forensics } : {}),
  };
}

export async function traceUrl(
  rawUrl: string,
  userAgentPreset: UserAgentPreset = "desktop-chrome",
): Promise<RedirectAnalysis> {
  let activePresetKey: UserAgentPreset = userAgentPreset;
  let activePreset = USER_AGENT_PRESETS[activePresetKey] ?? USER_AGENT_PRESETS["desktop-chrome"];
  const startUrl = normalizeUrl(rawUrl);
  const deadline = Date.now() + OVERALL_TIMEOUT_MS;
  const hops: HopDraft[] = [];
  const seen = new Set<string>();
  const cookieJar = new TraceCookieJar();

  let current = startUrl;
  let pendingReferer: string | null = null;
  let redirectLoop = false;
  let truncated = false;
  let error: string | null = null;
  let terminationReason = "final-response";
  let terminationDetail: string | null = null;
  let finalDestinationConfirmed = true;
  let browserFallbackUsed = false;
  let browserFallbackNote: string | null = null;
  let page: import("./redirect-analysis").PageMetaInput = {
    canonical: null,
    metaRobots: null,
  };

  try {
    new URL(startUrl);
  } catch {
    return finish({
      startUrl: rawUrl,
      hops,
      redirectLoop: false,
      truncated: false,
      page,
      error: "That does not look like a valid URL.",
      terminationReason: "invalid-url",
      terminationDetail: "The value entered could not be parsed as a URL.",
      finalDestinationConfirmed: false,
      browserFallbackUsed,
      browserFallbackNote,
      userAgentPreset: activePresetKey,
      userAgentLabel: activePreset.label,
    });
  }

  for (let i = 0; i < MAX_HOPS; i += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 1000) {
      terminationReason = "timeout";
      terminationDetail = `The overall analysis budget of ${Math.round(OVERALL_TIMEOUT_MS / 1000)}s was reached before the chain ended.`;
      finalDestinationConfirmed = false;
      break;
    }

    const key = canonicalKey(current);
    if (seen.has(key)) {
      redirectLoop = true;
      terminationReason = "loop";
      terminationDetail = `The chain returned to ${current}, which was already visited.`;
      finalDestinationConfirmed = false;
      break;
    }
    seen.add(key);

    // Pre-scan the current hop URL for nested/encoded target URLs
    const embeddedTargets = extractEmbeddedTargets(current);

    // --- Safety gate: every destination is validated before it is requested.
    const verdict = await assertSafeUrl(current, Math.min(5000, remaining));
    if (!verdict.ok) {
      hops.push(
        makeHop({
          index: i,
          url: current,
          mechanism: "blocked",
          blockedReason: verdict.reason,
          mechanismDetail: verdict.reason,
          redirectType: "Blocked destination",
          ...(embeddedTargets.length > 0 ? { forensics: { embeddedTargets } } : {}),
        }),
      );
      terminationReason = "blocked";
      terminationDetail = verdict.reason;
      finalDestinationConfirmed = false;
      break;
    }

    const hopTimeout = Math.min(PER_HOP_TIMEOUT_MS, deadline - Date.now());
    const started = Date.now();
    const { headerValue: cookieHeader, names: cookiesSent } = cookieJar.getCookiesFor(current);
    const refererSent = pendingReferer;
    const reqHeaders = buildHopRequestHeaders(activePresetKey, cookieHeader, refererSent);

    let response: Response;
    try {
      response = await fetch(current, {
        method: "GET",
        redirect: "manual",
        headers: reqHeaders,
        signal: AbortSignal.timeout(Math.max(1000, hopTimeout)),
      });
    } catch (e) {
      const message =
        e instanceof Error && e.name === "TimeoutError"
          ? `No response within ${Math.round(hopTimeout / 1000)}s (per-hop timeout).`
          : e instanceof Error
            ? e.message
            : "Request failed.";

      // If this hop failed at network level BUT carries an embedded target URL in its query/path,
      // unwrap the embedded target so secret/gateway links are still traced to their destination!
      const fallbackEmbedded = embeddedTargets[0];
      if (fallbackEmbedded) {
        const resolved = resolveAgainst(current, fallbackEmbedded.url);
        if (resolved && !seen.has(canonicalKey(resolved))) {
          hops.push(
            makeHop({
              index: i,
              url: current,
              mechanism: "gateway-unwrap",
              responseTimeMs: Date.now() - started,
              redirectType: "Gateway Unwrap",
              location: fallbackEmbedded.url,
              resolvedLocation: resolved,
              nextUrl: resolved,
              mechanismDetail: `Gateway unreachable (${message}); unwrapped ${fallbackEmbedded.source}`,
              evidence: `${fallbackEmbedded.source} → ${fallbackEmbedded.url}`,
              addresses: verdict.addresses,
              forensics: {
                embeddedTargets,
                ...(cookiesSent.length > 0 ? { cookiesSent } : {}),
                refererSent,
                deobfuscationSteps: [
                  `Gateway request failed (${message})`,
                  `Unwrapped embedded destination from ${fallbackEmbedded.source} (${fallbackEmbedded.encoding})`,
                ],
              },
            }),
          );
          pendingReferer = computeNextReferer(current, resolved, null);
          current = resolved;
          continue;
        }
      }

      hops.push(
        makeHop({
          index: i,
          url: current,
          mechanism: "error",
          responseTimeMs: Date.now() - started,
          blockedReason: message,
          mechanismDetail: message,
          redirectType: "Request failed",
          addresses: verdict.addresses,
          forensics: {
            ...(embeddedTargets.length > 0 ? { embeddedTargets } : {}),
            ...(cookiesSent.length > 0 ? { cookiesSent } : {}),
            refererSent,
          },
        }),
      );
      error = message;
      terminationReason = "request-failed";
      terminationDetail = message;
      finalDestinationConfirmed = false;
      break;
    }

    let rawSetCookies = extractRawSetCookies(response.headers);
    let cookiesSet = cookieJar.ingestSetCookieHeaders(rawSetCookies, current);
    let headers = headersToObject(response.headers);
    let referrerPolicyHeader = response.headers.get("referrer-policy");

    const adaptationNotes: string[] = [];

    // --- Adaptive OS / Device Retry: if a regular browser profile hits HTTP 400/403/406/412/415
    // (common for mobile-only CPA/affiliate offers or OS-gated shortlinks), automatically probe
    // Android Chrome / iPhone Safari / Desktop Chrome while honoring SSRF + timeout budgets.
    let preReadBody: string | null = null;
    if (
      !isSpecialBotPreset(activePresetKey) &&
      (response.status === 400 ||
        response.status === 403 ||
        response.status === 406 ||
        response.status === 412 ||
        response.status === 415) &&
      !response.headers.get("location") &&
      !response.headers.get("hx-redirect") &&
      !response.headers.get("x-redirect") &&
      !response.headers.get("x-redirect-to") &&
      !response.headers.get("refresh") &&
      deadline - Date.now() > 4500
    ) {
      preReadBody = await readResponseTextSafe(response);
      const initialRejectReason = extractUpstreamBlockReason(preReadBody);
      const shouldProbeAltOs =
        isOsOrDeviceRejectionMessage(initialRejectReason) ||
        response.status === 403 ||
        response.status === 406;

      if (shouldProbeAltOs) {
        const candidates = OS_FALLBACK_ORDER.filter((p) => p !== activePresetKey);
        for (const candidatePreset of candidates) {
          if (deadline - Date.now() <= 2500) break;
          const retryHeaders = buildHopRequestHeaders(
            candidatePreset,
            cookieJar.getCookiesFor(current).headerValue,
            refererSent,
          );
          try {
            const retryRes = await fetch(current, {
              method: "GET",
              redirect: "manual",
              headers: retryHeaders,
              signal: AbortSignal.timeout(Math.min(7000, deadline - Date.now())),
            });
            const hasRetryRedirect =
              isRedirect(retryRes.status) ||
              Boolean(
                retryRes.headers.get("location") ??
                retryRes.headers.get("hx-redirect") ??
                retryRes.headers.get("x-redirect") ??
                retryRes.headers.get("x-redirect-to") ??
                retryRes.headers.get("refresh"),
              );

            if (hasRetryRedirect || (retryRes.status >= 200 && retryRes.status < 300)) {
              const oldLabel = activePreset.label;
              activePresetKey = candidatePreset;
              activePreset = USER_AGENT_PRESETS[candidatePreset];
              adaptationNotes.push(
                `${oldLabel} received HTTP ${response.status}${initialRejectReason ? ` ("${initialRejectReason}")` : ""}; switched to ${activePreset.label} and unlocked hop`,
              );
              response = retryRes;
              preReadBody = null;
              rawSetCookies = extractRawSetCookies(response.headers);
              cookiesSet = cookieJar.ingestSetCookieHeaders(rawSetCookies, current);
              headers = headersToObject(response.headers);
              referrerPolicyHeader = response.headers.get("referrer-policy");
              break;
            }

            const retryBody = await readResponseTextSafe(retryRes);
            const retryJsonTarget = retryBody ? extractJsonRedirectTarget(retryBody) : null;
            if (retryJsonTarget) {
              const oldLabel = activePreset.label;
              activePresetKey = candidatePreset;
              activePreset = USER_AGENT_PRESETS[candidatePreset];
              adaptationNotes.push(
                `${oldLabel} received HTTP ${response.status}; switched to ${activePreset.label} and extracted JSON redirect`,
              );
              response = retryRes;
              preReadBody = retryBody;
              rawSetCookies = extractRawSetCookies(response.headers);
              cookiesSet = cookieJar.ingestSetCookieHeaders(rawSetCookies, current);
              headers = headersToObject(response.headers);
              referrerPolicyHeader = response.headers.get("referrer-policy");
              break;
            }

            const retryReason = retryBody ? extractUpstreamBlockReason(retryBody) : null;
            if (retryReason && retryReason !== initialRejectReason) {
              adaptationNotes.push(
                `Tested ${USER_AGENT_PRESETS[candidatePreset].label}: bypassed OS check (${initialRejectReason ?? response.status}), hit upstream gate HTTP ${retryRes.status} ("${retryReason}")`,
              );
              if (
                isOsOrDeviceRejectionMessage(initialRejectReason) &&
                !isOsOrDeviceRejectionMessage(retryReason)
              ) {
                response = retryRes;
                preReadBody = retryBody;
              }
            }
          } catch {
            // Try next OS profile
          }
        }
      }
    }

    const responseTimeMs = Date.now() - started;

    const baseForensics: HopForensics = {
      ...(adaptationNotes.length > 0 ? { deobfuscationSteps: adaptationNotes } : {}),
      ...(cookiesSet.length > 0 ? { cookiesSet } : {}),
      ...(cookiesSent.length > 0 ? { cookiesSent } : {}),
      refererSent,
      ...(embeddedTargets.length > 0 ? { embeddedTargets } : {}),
      securityHeaders: {
        hsts: Boolean(response.headers.get("strict-transport-security")),
        csp: Boolean(response.headers.get("content-security-policy")),
        xFrameOptions: response.headers.get("x-frame-options"),
        referrerPolicy: referrerPolicyHeader,
      },
    };

    const base = {
      index: i,
      url: current,
      status: response.status,
      statusText: response.statusText || "",
      responseTimeMs,
      headers,
      server: response.headers.get("server"),
      ip:
        response.headers.get("x-served-by") ??
        response.headers.get("x-amz-cf-pop") ??
        response.headers.get("cf-ray") ??
        verdict.addresses[0] ??
        null,
      addresses: verdict.addresses,
      forensics: baseForensics,
    };

    // --- 1. HTTP Location or custom Redirect header (Location, HX-Redirect, X-Redirect, X-Redirect-To)
    const locationHeader =
      response.headers.get("location") ??
      response.headers.get("hx-redirect") ??
      response.headers.get("x-redirect") ??
      response.headers.get("x-redirect-to");
    const hasCustomRedirectHeader = !response.headers.get("location") && Boolean(locationHeader);

    if (isRedirect(response.status) || hasCustomRedirectHeader) {
      const resolved = locationHeader ? resolveAgainst(current, locationHeader) : null;
      hops.push(
        makeHop({
          ...base,
          mechanism: "http-redirect",
          redirectType: hasCustomRedirectHeader
            ? "Custom Header Redirect"
            : redirectTypeLabel(response.status),
          location: locationHeader,
          resolvedLocation: resolved,
          nextUrl: resolved,
          mechanismDetail: hasCustomRedirectHeader
            ? `${response.status} response with redirect header`
            : `${response.status} ${redirectTypeLabel(response.status)}`,
          blockedReason: resolved
            ? null
            : locationHeader
              ? `The Location header "${locationHeader}" is not a valid URL.`
              : "This redirect has no Location header (dead end).",
        }),
      );
      await response.body?.cancel().catch(() => {});
      if (!resolved) {
        terminationReason = "dead-end";
        terminationDetail = hops[hops.length - 1]!.blockedReason;
        finalDestinationConfirmed = false;
        break;
      }
      pendingReferer = computeNextReferer(current, resolved, referrerPolicyHeader);
      current = resolved;
      if (i === MAX_HOPS - 1) {
        truncated = true;
        terminationReason = "max-hops";
        terminationDetail = `Stopped after the maximum of ${MAX_HOPS} hops.`;
        finalDestinationConfirmed = false;
      }
      continue;
    }

    // --- 2. HTTP Refresh header (non-3xx client-side redirect)
    const refreshHeader = response.headers.get("refresh");
    const refresh = refreshHeader ? parseRefreshValue(refreshHeader) : null;
    if (refresh?.url) {
      const resolved = resolveAgainst(current, refresh.url);
      hops.push(
        makeHop({
          ...base,
          mechanism: "meta-refresh",
          redirectType: "Refresh header",
          location: refresh.url,
          resolvedLocation: resolved,
          nextUrl: resolved,
          mechanismDetail: `HTTP Refresh header (${refresh.delay}s)`,
          evidence: refreshHeader,
          blockedReason: resolved ? null : `Refresh target "${refresh.url}" is not a valid URL.`,
        }),
      );
      await response.body?.cancel().catch(() => {});
      if (!resolved) {
        terminationReason = "dead-end";
        finalDestinationConfirmed = false;
        break;
      }
      pendingReferer = computeNextReferer(current, resolved, referrerPolicyHeader);
      current = resolved;
      continue;
    }

    // --- 3. Inspect the body (HTML, JSON API, JS endpoint, or text) for hidden redirects & upstream errors
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    const bodyText = preReadBody !== null ? preReadBody : await readResponseTextSafe(response);
    const html =
      contentType.includes("javascript") || contentType.includes("ecmascript")
        ? `<script>${bodyText}</script>`
        : bodyText;

    // 3a. JSON API redirect payloads (only follow on 2xx or explicitly non-error payloads)
    const jsonRedirect = bodyText ? extractJsonRedirectTarget(bodyText) : null;
    if (jsonRedirect && response.status < 400) {
      const resolved = resolveAgainst(current, jsonRedirect.url);
      baseForensics.deobfuscationSteps = [
        ...(baseForensics.deobfuscationSteps ?? []),
        `Extracted redirect URL from JSON response field "${jsonRedirect.keyPath}"`,
      ];
      hops.push(
        makeHop({
          ...base,
          mechanism: "javascript-redirect",
          redirectType: "JSON API Redirect",
          location: jsonRedirect.url,
          resolvedLocation: resolved,
          nextUrl: resolved,
          mechanismDetail: `${response.status} JSON response containing "${jsonRedirect.keyPath}" redirect`,
          evidence: `"${jsonRedirect.keyPath}": "${jsonRedirect.url}"`,
          blockedReason: resolved
            ? null
            : `The JSON redirect target "${jsonRedirect.url}" is not a valid URL.`,
          forensics: baseForensics,
        }),
      );
      if (!resolved) {
        terminationReason = "dead-end";
        terminationDetail = `JSON redirect "${jsonRedirect.url}" could not be resolved.`;
        finalDestinationConfirmed = false;
        break;
      }
      pendingReferer = computeNextReferer(current, resolved, referrerPolicyHeader);
      current = resolved;
      if (i === MAX_HOPS - 1) {
        truncated = true;
        terminationReason = "max-hops";
        finalDestinationConfirmed = false;
      }
      continue;
    }

    if (html && !html.trimStart().startsWith("{")) {
      page = extractPageMeta(html, current);
    }

    const detection = html
      ? detectClientRedirect(html, current)
      : { signal: null, hint: null, hiddenArtifacts: [] };

    if (detection.hiddenArtifacts.length > 0) {
      baseForensics.hiddenArtifacts = detection.hiddenArtifacts;
    }

    if (detection.signal) {
      const resolved = resolveAgainst(current, detection.signal.rawTarget);
      const mechanism: HopMechanism =
        detection.signal.kind === "meta-refresh"
          ? "meta-refresh"
          : detection.signal.kind === "form-redirect"
            ? "form-redirect"
            : "javascript-redirect";
      if (detection.signal.deobfuscationSteps?.length) {
        baseForensics.deobfuscationSteps = [
          ...(baseForensics.deobfuscationSteps ?? []),
          ...detection.signal.deobfuscationSteps,
        ];
      }
      hops.push(
        makeHop({
          ...base,
          mechanism,
          redirectType: MECHANISM_LABEL[mechanism],
          location: detection.signal.rawTarget,
          resolvedLocation: resolved,
          nextUrl: resolved,
          mechanismDetail: `${response.status} response containing ${detection.signal.method}`,
          evidence: detection.signal.evidence,
          blockedReason: resolved
            ? null
            : `The detected destination "${detection.signal.rawTarget}" is not a valid URL.`,
          forensics: baseForensics,
        }),
      );
      if (!resolved) {
        terminationReason = "dead-end";
        terminationDetail = `A ${detection.signal.method} navigation was found but its destination could not be resolved.`;
        finalDestinationConfirmed = false;
        break;
      }
      pendingReferer = computeNextReferer(current, resolved, referrerPolicyHeader);
      current = resolved;
      if (i === MAX_HOPS - 1) {
        truncated = true;
        terminationReason = "max-hops";
        finalDestinationConfirmed = false;
      }
      continue;
    }

    // --- 4. Embedded Gateway / Link-Shim Unwrap Fallback
    // If a known redirect wrapper or blocked gateway hop carries an embedded target URL in its
    // query string or path (e.g., ?url=https://..., ?u=aHR0cHM6..., l.facebook.com, google.com/url,
    // Proofpoint, SafeLinks), unwrap and follow it when the server didn't issue an HTTP redirect.
    const primaryEmbedded = embeddedTargets[0];
    if (
      primaryEmbedded &&
      (response.status >= 400 ||
        isLikelyGatewayOrWrapperUrl(current) ||
        (html && looksLikeRedirector(html)))
    ) {
      const resolved = resolveAgainst(current, primaryEmbedded.url);
      if (resolved && !seen.has(canonicalKey(resolved))) {
        baseForensics.deobfuscationSteps = [
          ...(baseForensics.deobfuscationSteps ?? []),
          `Unwrapped embedded target from ${primaryEmbedded.source} (${primaryEmbedded.encoding})`,
        ];
        hops.push(
          makeHop({
            ...base,
            mechanism: "gateway-unwrap",
            redirectType: "Gateway Unwrap",
            location: primaryEmbedded.url,
            resolvedLocation: resolved,
            nextUrl: resolved,
            mechanismDetail: `Unwrapped ${primaryEmbedded.source} (${primaryEmbedded.encoding})`,
            evidence: `${primaryEmbedded.source} → ${primaryEmbedded.url}`,
            forensics: baseForensics,
          }),
        );
        pendingReferer = computeNextReferer(current, resolved, referrerPolicyHeader);
        current = resolved;
        if (i === MAX_HOPS - 1) {
          truncated = true;
          terminationReason = "max-hops";
          finalDestinationConfirmed = false;
        }
        continue;
      }
    }

    const upstreamBlockReason =
      response.status >= 400 && bodyText ? extractUpstreamBlockReason(bodyText) : null;

    const hasExternalScriptInThinPage =
      Boolean(html) &&
      looksLikeRedirector(html) &&
      /<script[^>]+src\s*=\s*["'][^"']+["']/i.test(html);
    const isBotChallengedHop =
      (response.status === 403 || response.status === 429 || response.status === 503) &&
      !upstreamBlockReason?.startsWith("Access not allowed");

    if (detection.hint || hasExternalScriptInThinPage || isBotChallengedHop) {
      // Dynamic navigation, external script redirector, or anti-bot interstitial:
      // resolve in our sandboxed headless Chromium engine.
      const triggerMethod =
        detection.hint?.method ??
        (hasExternalScriptInThinPage
          ? "external <script src> redirector"
          : `HTTP ${response.status} challenge / interstitial`);
      const browserBudget = Math.min(25_000, deadline - Date.now());
      const rendered =
        browserBudget > 4500
          ? await traceWithBrowser(current, browserBudget, activePreset.ua)
          : {
              ok: false as const,
              reason: "Not enough time left in the analysis budget to run the headless browser.",
              finalUrl: null,
              navigations: [],
              elapsedMs: 0,
            };

      if (
        rendered.ok &&
        rendered.finalUrl &&
        canonicalKey(rendered.finalUrl) !== canonicalKey(current)
      ) {
        browserFallbackUsed = true;
        const navSteps = rendered.navigations
          .filter((n) => canonicalKey(n.url) !== canonicalKey(current))
          .map((n) => `Browser hop (${n.method}): ${n.url} [${n.ms} ms]`);
        baseForensics.deobfuscationSteps = [
          ...(baseForensics.deobfuscationSteps ?? []),
          `Executed ${triggerMethod} in isolated headless Chromium (${rendered.elapsedMs} ms)`,
          ...navSteps,
        ];
        if (rendered.finalHtml) {
          page = extractPageMeta(rendered.finalHtml, rendered.finalUrl);
        }
        hops.push(
          makeHop({
            ...base,
            mechanism: "browser-navigation",
            redirectType: "Browser Navigation",
            location: rendered.finalUrl,
            resolvedLocation: rendered.finalUrl,
            nextUrl: rendered.finalUrl,
            mechanismDetail: `${triggerMethod}, resolved in headless browser (${rendered.elapsedMs} ms)`,
            evidence: detection.hint?.evidence ?? null,
            forensics: baseForensics,
          }),
        );
        pendingReferer = computeNextReferer(current, rendered.finalUrl, referrerPolicyHeader);
        current = rendered.finalUrl;
        continue;
      }

      if (detection.hint && looksLikeRedirector(html)) {
        const reason = rendered.ok
          ? "The isolated browser loaded the page without navigating anywhere else, so this is treated as the final destination."
          : rendered.reason;
        if (!rendered.ok) {
          browserFallbackNote = reason;
          finalDestinationConfirmed = false;
          terminationReason = browserFallbackConfigured()
            ? "browser-failed"
            : "browser-unavailable";
          terminationDetail = reason;
        }
        hops.push(
          makeHop({
            ...base,
            mechanism: rendered.ok ? "final-response" : "unresolved",
            redirectType: rendered.ok ? "Final Response" : "Client-side redirect not followed",
            mechanismDetail: `Page contains ${detection.hint.method}`,
            evidence: detection.hint.evidence,
            blockedReason: rendered.ok ? null : reason,
            forensics: baseForensics,
          }),
        );
        break;
      }
    }

    // --- 5. Genuine final response (or hard upstream 4xx/5xx gate)
    hops.push(
      makeHop({
        ...base,
        mechanism: response.status >= 400 ? "error" : "final-response",
        redirectType: redirectTypeLabel(response.status),
        blockedReason: response.status >= 400 ? upstreamBlockReason : null,
        mechanismDetail:
          response.status >= 400
            ? upstreamBlockReason
              ? `HTTP ${response.status} — ${upstreamBlockReason}`
              : `${response.status} ${redirectTypeLabel(response.status)} — chain ends with an error response`
            : "No further redirect found (HTTP, meta refresh, form, gateway, JSON or JavaScript).",
        evidence:
          response.status >= 400 && upstreamBlockReason && bodyText.trim().startsWith("{")
            ? bodyText.trim().slice(0, 220)
            : null,
        forensics: baseForensics,
      }),
    );
    if (response.status >= 400) {
      terminationReason = "error-response";
      terminationDetail = upstreamBlockReason
        ? `Upstream server responded with HTTP ${response.status}: "${upstreamBlockReason}".`
        : `The chain ends on a ${response.status} response.`;
      finalDestinationConfirmed = false;
    }
    break;
  }

  return finish({
    startUrl,
    hops,
    redirectLoop,
    truncated,
    page,
    error,
    terminationReason,
    terminationDetail,
    finalDestinationConfirmed,
    browserFallbackUsed,
    browserFallbackNote,
    userAgentPreset: activePresetKey,
    userAgentLabel: activePreset.label,
  });
}

function finish(input: {
  startUrl: string;
  hops: RedirectHop[];
  redirectLoop: boolean;
  truncated: boolean;
  page: import("./redirect-analysis").PageMetaInput;
  error: string | null;
  terminationReason: string;
  terminationDetail: string | null;
  finalDestinationConfirmed: boolean;
  browserFallbackUsed: boolean;
  browserFallbackNote: string | null;
  userAgentPreset: UserAgentPreset;
  userAgentLabel: string;
}): RedirectAnalysis {
  const analysis = assemble({
    startUrl: input.startUrl,
    hops: input.hops,
    redirectLoop: input.redirectLoop,
    truncated: input.truncated,
    page: input.page,
    source: "live",
    error: input.error,
  });
  return {
    ...analysis,
    userAgentPreset: input.userAgentPreset,
    userAgentLabel: input.userAgentLabel,
    terminationReason: input.terminationReason,
    terminationDetail: input.terminationDetail,
    finalDestinationConfirmed: input.finalDestinationConfirmed,
    browserFallbackUsed: input.browserFallbackUsed,
    browserFallbackNote: input.browserFallbackNote,
  };
}
