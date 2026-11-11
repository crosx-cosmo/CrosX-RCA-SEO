/**
 * Enterprise Security, Anti-DDoS, WAF, & Multi-User Single-Time Concurrency Engine.
 *
 * Protects all SSR pages, TanStack server functions, short-link redirects, and
 * public API endpoints against:
 *  - DDoS floods & burst traffic spikes (sliding window + micro-burst limiter + repeat-offender lockout)
 *  - Multi-user single-time concurrency stampedes (per-IP & global semaphores + Singleflight request coalescing)
 *  - Vulnerability scanners, SQLi, XSS, path traversal, null-byte & dotfile probes (WAF inspector)
 *  - Oversized payloads, header bombs, and disallowed HTTP verbs
 */

export type RateLimitTier = "global" | "trace" | "shortlink-write" | "shortlink-redirect";

interface TierPolicy {
  windowMs: number;
  maxPerWindow: number;
  burstWindowMs: number;
  maxPerBurst: number;
  maxConcurrentPerIp: number;
  maxConcurrentGlobal: number;
}

const TIER_POLICIES: Record<RateLimitTier, TierPolicy> = {
  global: {
    windowMs: 60_000,
    maxPerWindow: 360,
    burstWindowMs: 5_000,
    maxPerBurst: 120,
    maxConcurrentPerIp: 40,
    maxConcurrentGlobal: 300,
  },
  trace: {
    windowMs: 60_000,
    maxPerWindow: 30,
    burstWindowMs: 5_000,
    maxPerBurst: 8,
    maxConcurrentPerIp: 4,
    maxConcurrentGlobal: 40,
  },
  "shortlink-write": {
    windowMs: 60_000,
    maxPerWindow: 30,
    burstWindowMs: 5_000,
    maxPerBurst: 8,
    maxConcurrentPerIp: 4,
    maxConcurrentGlobal: 50,
  },
  "shortlink-redirect": {
    windowMs: 60_000,
    maxPerWindow: 120,
    burstWindowMs: 5_000,
    maxPerBurst: 25,
    maxConcurrentPerIp: 10,
    maxConcurrentGlobal: 150,
  },
};

interface ClientBucket {
  windowStart: number;
  windowCount: number;
  burstStart: number;
  burstCount: number;
  strikes: number;
  blockedUntil: number;
  lastSeen: number;
}

const MAX_TRACKED_CLIENTS = 10_000;
const PENALTY_BASE_MS = 30_000;
const PENALTY_MAX_MS = 600_000;
const SLOT_SAFETY_TTL_MS = 60_000;

const rateBuckets = new Map<string, ClientBucket>();
const activePerIp = new Map<string, number>();
const activeGlobal: Record<RateLimitTier, number> = {
  global: 0,
  trace: 0,
  "shortlink-write": 0,
  "shortlink-redirect": 0,
};
const inFlightTasks = new Map<string, Promise<unknown>>();

const ALLOWED_METHODS = new Set(["GET", "HEAD", "POST", "OPTIONS"]);
const MAX_URL_LENGTH = 4096;
const MAX_HEADER_BYTES = 16_384;
const MAX_SINGLE_HEADER_BYTES = 4096;
const MAX_POST_BODY_BYTES = 65_536;

const SCANNER_UA_RE =
  /\b(sqlmap|nikto|nuclei|masscan|zgrab|gobuster|dirbuster|wpscan|acunetix|nessus|openvas|feroxbuster|ffuf|commix|havij|jaeles|xray|arachni|vega|w3af)\b/i;

const BLOCKED_PATH_RE =
  /(?:^|\/)(?:\.env(?:\..+)?|\.git(?:\/|$)|\.svn|\.hg|\.DS_Store|wp-admin|wp-login\.php|xmlrpc\.php|phpmyadmin|pma|cgi-bin|etc\/passwd|proc\/self|vendor\/phpunit|actuator|boaform|HNAP1|_ignition)(?:\/|$|\?)/i;

const PATH_TRAVERSAL_RE = /(?:%00|\0|\.\.\/|\.\.\\|%2e%2e%2f|%2e%2e\/|\.\.%2f|%252e%252e)/i;

const MALICIOUS_PAYLOAD_RE =
  /(?:<\s*script\b|javascript\s*:|vbscript\s*:|on(?:error|load|mouseover|focus)\s*=|\bunion\s+(?:all\s+)?select\b|\bselect\b.{1,40}\bfrom\s+information_schema\b|(?:'|")\s*or\s+(?:'1'\s*=\s*'1'|1\s*=\s*1)|\b(?:sleep|benchmark)\s*\(\s*\d+\s*\)|;\s*(?:cat|ls|wget|curl|bash|sh)\s+\/)/i;

export interface WafVerdict {
  ok: boolean;
  status: number;
  reason: string | null;
}

export interface RateLimitVerdict {
  ok: boolean;
  status: number;
  limit: number;
  remaining: number;
  resetEpochSeconds: number;
  retryAfterSeconds: number;
  reason: string | null;
}

export interface ConcurrencyLease {
  ok: boolean;
  reason: string | null;
  activeIp: number;
  activeGlobal: number;
  release: () => void;
}

/** Constant-time string comparison to prevent timing side-channel attacks on secrets/tokens. */
export function constantTimeEquals(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const bufA = enc.encode(a);
  const bufB = enc.encode(b);
  const len = Math.max(bufA.length, bufB.length);
  let diff = bufA.length ^ bufB.length;
  for (let i = 0; i < len; i++) {
    diff |= (bufA[i] ?? 0) ^ (bufB[i] ?? 0);
  }
  return diff === 0;
}

/** Extracts and normalizes the client IP address from reverse-proxy headers. */
export function extractClientIp(request?: Request | null): string {
  if (!request) return "local";
  const headers = request.headers;
  const raw =
    headers.get("cf-connecting-ip") ??
    headers.get("true-client-ip") ??
    headers.get("x-real-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0] ??
    "";
  const cleaned = raw.trim().replace(/^\[|\]$/g, "");
  if (!cleaned) return "anonymous";
  // Strip IPv4:port suffix if present
  const ipv4Port = cleaned.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  if (ipv4Port?.[1]) return ipv4Port[1];
  return cleaned.slice(0, 64);
}

/** Fast non-cryptographic FNV-1a 32-bit hash for client header fingerprinting. */
function fnv1aHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** Combines client IP with UA/language fingerprint to isolate multi-user NAT & botnet traffic. */
export function extractClientFingerprint(request?: Request | null): string {
  if (!request) return "local:internal";
  const ip = extractClientIp(request);
  const ua = (request.headers.get("user-agent") ?? "").slice(0, 160);
  const lang = (request.headers.get("accept-language") ?? "").slice(0, 48);
  return `${ip}:${fnv1aHash(`${ua}|${lang}`)}`;
}

/**
 * Inspects an incoming HTTP Request for exploit scanners, path traversal,
 * oversized headers/bodies, disallowed verbs, and SQLi/XSS attack payloads.
 */
export function inspectIncomingRequest(request: Request): WafVerdict {
  const method = request.method.toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    return { ok: false, status: 405, reason: `HTTP method ${method} is not allowed.` };
  }

  if (request.url.length > MAX_URL_LENGTH) {
    return { ok: false, status: 414, reason: "Request URI exceeds maximum safe length." };
  }

  let totalHeaderBytes = 0;
  for (const [k, v] of request.headers.entries()) {
    const entryLen = k.length + v.length;
    if (entryLen > MAX_SINGLE_HEADER_BYTES) {
      return { ok: false, status: 431, reason: "Request header field is too large." };
    }
    totalHeaderBytes += entryLen;
    if (totalHeaderBytes > MAX_HEADER_BYTES) {
      return { ok: false, status: 431, reason: "Request headers exceed maximum size." };
    }
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_POST_BODY_BYTES) {
    return { ok: false, status: 413, reason: "Request payload exceeds maximum allowed size." };
  }

  const ua = request.headers.get("user-agent") ?? "";
  if (ua && SCANNER_UA_RE.test(ua)) {
    return { ok: false, status: 403, reason: "Automated vulnerability scanner blocked." };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(request.url);
  } catch {
    return { ok: false, status: 400, reason: "Malformed request URL." };
  }

  const rawPathAndQuery = `${parsedUrl.pathname}${parsedUrl.search}`;
  if (PATH_TRAVERSAL_RE.test(rawPathAndQuery)) {
    return { ok: false, status: 403, reason: "Path traversal or null-byte sequence blocked." };
  }

  let decodedPath = parsedUrl.pathname;
  try {
    decodedPath = decodeURIComponent(parsedUrl.pathname);
  } catch {
    return { ok: false, status: 400, reason: "Malformed URL percent-encoding." };
  }

  if (PATH_TRAVERSAL_RE.test(decodedPath) || BLOCKED_PATH_RE.test(decodedPath)) {
    return { ok: false, status: 403, reason: "Access to restricted path blocked." };
  }

  // Inspect query parameters (excluding `url`/`urls` which hold user target URLs validated by SSRF)
  for (const [key, val] of parsedUrl.searchParams.entries()) {
    if (MALICIOUS_PAYLOAD_RE.test(key)) {
      return { ok: false, status: 403, reason: "Malicious query parameter blocked." };
    }
    if (key !== "url" && key !== "urls" && MALICIOUS_PAYLOAD_RE.test(val)) {
      return { ok: false, status: 403, reason: "Malicious query payload blocked." };
    }
  }

  return { ok: true, status: 200, reason: null };
}

function pruneBuckets(now: number): void {
  if (rateBuckets.size <= MAX_TRACKED_CLIENTS) return;
  for (const [k, b] of rateBuckets) {
    if (b.blockedUntil < now && now - b.lastSeen > 120_000) {
      rateBuckets.delete(k);
    }
    if (rateBuckets.size <= MAX_TRACKED_CLIENTS * 0.8) break;
  }
  if (rateBuckets.size > MAX_TRACKED_CLIENTS) {
    const oldest = rateBuckets.keys().next().value;
    if (oldest) rateBuckets.delete(oldest);
  }
}

/**
 * Evaluates sliding-window + micro-burst rate limits for a client key and tier,
 * applying automatic exponential cooldowns to repeat burst offenders.
 */
export function checkRateLimit(
  clientKey: string,
  tier: RateLimitTier = "global",
  now = Date.now(),
): RateLimitVerdict {
  const policy = TIER_POLICIES[tier];
  const bucketKey = `${tier}:${clientKey}`;
  pruneBuckets(now);

  let bucket = rateBuckets.get(bucketKey);
  if (!bucket) {
    bucket = {
      windowStart: now,
      windowCount: 0,
      burstStart: now,
      burstCount: 0,
      strikes: 0,
      blockedUntil: 0,
      lastSeen: now,
    };
    rateBuckets.set(bucketKey, bucket);
  }
  bucket.lastSeen = now;

  if (bucket.blockedUntil > now) {
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.blockedUntil - now) / 1000));
    return {
      ok: false,
      status: 429,
      limit: policy.maxPerWindow,
      remaining: 0,
      resetEpochSeconds: Math.ceil(bucket.blockedUntil / 1000),
      retryAfterSeconds,
      reason: `Too many rapid requests. Temporarily throttled for ${retryAfterSeconds}s.`,
    };
  }

  if (now - bucket.windowStart >= policy.windowMs) {
    bucket.windowStart = now;
    bucket.windowCount = 0;
    if (bucket.strikes > 0) bucket.strikes = Math.max(0, bucket.strikes - 1);
  }

  if (now - bucket.burstStart >= policy.burstWindowMs) {
    bucket.burstStart = now;
    bucket.burstCount = 0;
  }

  bucket.windowCount += 1;
  bucket.burstCount += 1;

  const windowResetMs = bucket.windowStart + policy.windowMs;
  const burstResetMs = bucket.burstStart + policy.burstWindowMs;
  const remaining = Math.max(0, policy.maxPerWindow - bucket.windowCount);

  if (bucket.burstCount > policy.maxPerBurst || bucket.windowCount > policy.maxPerWindow) {
    bucket.strikes += 1;
    const isBurstViolation = bucket.burstCount > policy.maxPerBurst;
    if (bucket.strikes >= 3) {
      const penalty = Math.min(PENALTY_MAX_MS, PENALTY_BASE_MS * 2 ** (bucket.strikes - 3));
      bucket.blockedUntil = now + penalty;
    }
    const resetTarget =
      bucket.blockedUntil > now
        ? bucket.blockedUntil
        : isBurstViolation
          ? burstResetMs
          : windowResetMs;
    const retryAfterSeconds = Math.max(1, Math.ceil((resetTarget - now) / 1000));

    return {
      ok: false,
      status: 429,
      limit: policy.maxPerWindow,
      remaining: 0,
      resetEpochSeconds: Math.ceil(resetTarget / 1000),
      retryAfterSeconds,
      reason: isBurstViolation
        ? "Burst rate limit exceeded. Please space out simultaneous requests."
        : "Rate limit exceeded. Please wait before sending more requests.",
    };
  }

  return {
    ok: true,
    status: 200,
    limit: policy.maxPerWindow,
    remaining,
    resetEpochSeconds: Math.ceil(windowResetMs / 1000),
    retryAfterSeconds: 0,
    reason: null,
  };
}

/**
 * Multi-User Single-Time Concurrency Throttle (Semaphore).
 * Caps simultaneous in-flight operations per IP AND globally across all users
 * so a sudden multi-user traffic wave cannot exhaust sockets or memory.
 */
export function acquireConcurrencySlot(
  ipKey: string,
  tier: RateLimitTier = "global",
): ConcurrencyLease {
  const policy = TIER_POLICIES[tier];
  const ipBucketKey = `${tier}:${ipKey}`;
  const currentIp = activePerIp.get(ipBucketKey) ?? 0;
  const currentGlobal = activeGlobal[tier];

  if (currentIp >= policy.maxConcurrentPerIp) {
    return {
      ok: false,
      reason: `Too many simultaneous requests from your connection (max ${policy.maxConcurrentPerIp} at once).`,
      activeIp: currentIp,
      activeGlobal: currentGlobal,
      release: () => {},
    };
  }

  if (currentGlobal >= policy.maxConcurrentGlobal) {
    return {
      ok: false,
      reason: "Server is handling high simultaneous traffic. Please retry in a few seconds.",
      activeIp: currentIp,
      activeGlobal: currentGlobal,
      release: () => {},
    };
  }

  activePerIp.set(ipBucketKey, currentIp + 1);
  activeGlobal[tier] = currentGlobal + 1;

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    clearTimeout(safetyTimer);
    const nextIp = (activePerIp.get(ipBucketKey) ?? 1) - 1;
    if (nextIp <= 0) activePerIp.delete(ipBucketKey);
    else activePerIp.set(ipBucketKey, nextIp);
    activeGlobal[tier] = Math.max(0, activeGlobal[tier] - 1);
  };

  const safetyTimer = setTimeout(release, SLOT_SAFETY_TTL_MS);
  if (typeof safetyTimer === "object" && "unref" in safetyTimer) {
    safetyTimer.unref();
  }

  return {
    ok: true,
    reason: null,
    activeIp: currentIp + 1,
    activeGlobal: currentGlobal + 1,
    release,
  };
}

/**
 * Singleflight In-Flight Request Coalescer.
 * When multiple users simultaneously trigger the exact same expensive operation
 * (e.g., tracing the same URL + User-Agent at the exact same moment), coalesces
 * them into a single execution and shares the result.
 */
export async function coalesceInFlight<T>(key: string, task: () => Promise<T>): Promise<T> {
  const existing = inFlightTasks.get(key) as Promise<T> | undefined;
  if (existing) {
    return existing;
  }
  const promise = (async () => {
    try {
      return await task();
    } finally {
      inFlightTasks.delete(key);
    }
  })();
  inFlightTasks.set(key, promise);
  return promise;
}

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https: blob:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://*.supabase.co https://rca.api.crosx.in https://bauval.org https: wss:",
  "frame-src 'self' https: data: blob:",
  "frame-ancestors 'self' https://*.crosx.in https://aistudio.google.com https://*.google.com https://*.googleusercontent.com https://*.run.app https://*.lovable.dev https://*.lovable.app https://*.lovableproject.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

/** Attaches hardened security, anti-clickjacking, CSP, HSTS, and timing headers. */
export function applySecurityHeaders(response: Response, durationMs?: number): Response {
  const headers = new Headers(response.headers);

  if (!headers.has("strict-transport-security")) {
    headers.set("strict-transport-security", "max-age=63072000; includeSubDomains; preload");
  }
  if (!headers.has("x-content-type-options")) {
    headers.set("x-content-type-options", "nosniff");
  }
  if (!headers.has("referrer-policy")) {
    headers.set("referrer-policy", "strict-origin-when-cross-origin");
  }
  if (!headers.has("x-dns-prefetch-control")) {
    headers.set("x-dns-prefetch-control", "on");
  }
  if (!headers.has("permissions-policy")) {
    headers.set(
      "permissions-policy",
      "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), interest-cohort=()",
    );
  }
  if (!headers.has("x-permitted-cross-domain-policies")) {
    headers.set("x-permitted-cross-domain-policies", "none");
  }
  if (!headers.has("content-security-policy")) {
    headers.set("content-security-policy", CONTENT_SECURITY_POLICY);
  }
  if (!headers.has("timing-allow-origin")) {
    headers.set("timing-allow-origin", "*");
  }
  if (typeof durationMs === "number") {
    headers.set("server-timing", `ssr;dur=${durationMs.toFixed(1)}`);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** Resets internal state for deterministic unit testing. */
export function resetSecurityStateForTests(): void {
  rateBuckets.clear();
  activePerIp.clear();
  activeGlobal.global = 0;
  activeGlobal.trace = 0;
  activeGlobal["shortlink-write"] = 0;
  activeGlobal["shortlink-redirect"] = 0;
  inFlightTasks.clear();
}
