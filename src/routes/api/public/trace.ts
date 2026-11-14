import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import type { RedirectAnalysis } from "@/lib/redirect-types";
import {
  acquireConcurrencySlot,
  checkRateLimit,
  coalesceInFlight,
  constantTimeEquals,
  extractClientFingerprint,
  extractClientIp,
  inspectIncomingRequest,
} from "@/lib/security.server";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, accept, authorization, x-requested-with",
  "access-control-expose-headers":
    "x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset, retry-after",
  "access-control-max-age": "86400",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  vary: "Origin",
};

const MAX_URLS = 5;
const RATE_LIMIT = 30;
const WINDOW_SECONDS = 60;

const uaSchema = z
  .enum([
    "desktop-chrome",
    "mobile-iphone",
    "mobile-android",
    "googlebot-smartphone",
    "googlebot-desktop",
    "social-bot",
  ])
  .optional();

const bodySchema = z.object({
  url: z.string().min(1).max(2048).optional(),
  urls: z.array(z.string().min(1).max(2048)).min(1).max(MAX_URLS).optional(),
  userAgent: uaSchema,
});

function json(data: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...CORS,
      ...extra,
    },
  });
}

async function run(
  urls: string[],
  userAgent?: z.infer<typeof uaSchema>,
): Promise<RedirectAnalysis[]> {
  const { traceUrl } = await import("@/lib/trace-engine.server");
  const ua = userAgent ?? "desktop-chrome";
  return Promise.all(
    urls.map((url) =>
      coalesceInFlight(`trace:${ua}:${url.trim()}`, () => traceUrl(url, userAgent)),
    ),
  );
}

const USAGE = {
  endpoint: "/api/public/trace",
  methods: ["GET", "POST"],
  get: "/api/public/trace?url=https://example.com&userAgent=googlebot-smartphone (repeat ?url= or comma-separate for batches)",
  post: { url: "https://example.com", userAgent: "desktop-chrome" },
  batch: { urls: ["https://example.com", "https://bit.ly/x"], userAgent: "mobile-iphone" },
  userAgents: [
    "desktop-chrome",
    "mobile-iphone",
    "mobile-android",
    "googlebot-smartphone",
    "googlebot-desktop",
    "social-bot",
  ],
  limits: {
    maxUrlsPerRequest: MAX_URLS,
    requestsPerMinute: RATE_LIMIT,
    maxConcurrentPerIp: 4,
    maxHops: 20,
    perHopTimeoutSeconds: 15,
    overallTimeoutSeconds: 55,
  },
  mechanisms: [
    "http-redirect",
    "meta-refresh",
    "javascript-redirect",
    "browser-navigation",
    "blocked",
    "final-response",
  ],
  docs: "/api-docs",
};

async function handle(request: Request, urls: string[], userAgent?: z.infer<typeof uaSchema>) {
  const waf = inspectIncomingRequest(request);
  if (!waf.ok) {
    return json({ error: waf.reason ?? "Blocked by WAF." }, waf.status);
  }

  const configuredApiKey =
    typeof process !== "undefined" ? process.env["REDIRECT_TRACER_API_KEY"]?.trim() : undefined;
  if (configuredApiKey) {
    const authHeader =
      request.headers.get("authorization") ?? request.headers.get("x-api-key") ?? "";
    const provided = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!provided || !constantTimeEquals(provided, configuredApiKey)) {
      return json({ error: "Unauthorized: valid API key required." }, 401);
    }
  }

  if (!urls.length) {
    return json({ error: "Provide a 'url' (or 'urls' array) to trace.", usage: USAGE }, 400);
  }
  if (urls.length > MAX_URLS) {
    return json({ error: `A maximum of ${MAX_URLS} URLs per request is allowed.` }, 400);
  }

  const ip = extractClientIp(request);
  const fp = extractClientFingerprint(request);
  const limit = checkRateLimit(fp, "trace");
  const headers: Record<string, string> = {
    "x-ratelimit-limit": String(limit.limit),
    "x-ratelimit-remaining": String(limit.remaining),
    "x-ratelimit-reset": String(limit.resetEpochSeconds),
  };
  if (!limit.ok) {
    headers["retry-after"] = String(limit.retryAfterSeconds);
    return json(
      {
        error: limit.reason ?? "Rate limit exceeded. Try again shortly.",
        limit: RATE_LIMIT,
        windowSeconds: WINDOW_SECONDS,
        retryAfterSeconds: limit.retryAfterSeconds,
      },
      429,
      headers,
    );
  }

  const slot = acquireConcurrencySlot(ip, "trace");
  if (!slot.ok) {
    headers["retry-after"] = "3";
    return json(
      {
        error: slot.reason ?? "Too many simultaneous trace requests.",
        retryAfterSeconds: 3,
      },
      429,
      headers,
    );
  }

  try {
    const results = await run(urls, userAgent);
    return json({ count: results.length, results }, 200, headers);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Trace failed" }, 500, headers);
  } finally {
    slot.release();
  }
}

export const Route = createFileRoute("/api/public/trace")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => {
        const params = new URL(request.url).searchParams;
        const urls = [...params.getAll("url"), ...params.getAll("urls")]
          .flatMap((v) => v.split(","))
          .map((v) => v.trim())
          .filter(Boolean)
          .slice(0, MAX_URLS + 1);
        const parsedUa = uaSchema.safeParse(params.get("userAgent") ?? undefined);
        if (!urls.length) return json({ ok: true, usage: USAGE });
        return handle(request, urls, parsedUa.success ? parsedUa.data : undefined);
      },
      POST: async ({ request }) => {
        let parsed: z.infer<typeof bodySchema>;
        try {
          parsed = bodySchema.parse(await request.json());
        } catch {
          return json(
            { error: "Invalid JSON body. Expected { url: string } or { urls: string[] }." },
            400,
          );
        }
        const urls = [...(parsed.url ? [parsed.url] : []), ...(parsed.urls ?? [])];
        return handle(request, urls, parsed.userAgent);
      },
    },
  },
});
