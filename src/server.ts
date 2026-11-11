import "./lib/error-capture";
import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import {
  acquireConcurrencySlot,
  applySecurityHeaders,
  checkRateLimit,
  extractClientFingerprint,
  extractClientIp,
  inspectIncomingRequest,
} from "./lib/security.server";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;
  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;
  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

function isStaticAssetPath(pathname: string): boolean {
  return (
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/icons/") ||
    pathname.startsWith("/@") ||
    pathname.startsWith("/src/") ||
    pathname.startsWith("/node_modules/") ||
    pathname === "/favicon.png" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml"
  );
}

function buildSecurityRejectionResponse(
  request: Request,
  status: number,
  message: string,
  extraHeaders: Record<string, string> = {},
): Response {
  const accept = request.headers.get("accept") ?? "";
  const isJson =
    accept.includes("application/json") || new URL(request.url).pathname.startsWith("/api/");
  const body = isJson
    ? JSON.stringify({ error: message, status })
    : `<!doctype html><meta charset="utf-8"><title>${status}</title><body style="font-family:system-ui;padding:3rem;text-align:center"><h1>${status}</h1><p>${message}</p><a href="/">Redirect Chain Analyzer</a></body>`;
  return applySecurityHeaders(
    new Response(body, {
      status,
      headers: {
        "content-type": isJson ? "application/json; charset=utf-8" : "text/html; charset=utf-8",
        "cache-control": "no-store",
        ...extraHeaders,
      },
    }),
  );
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    const start = performance.now();

    // 1. WAF & Malicious Request Shield
    const waf = inspectIncomingRequest(request);
    if (!waf.ok) {
      return buildSecurityRejectionResponse(
        request,
        waf.status,
        waf.reason ?? "Request blocked by security policy.",
      );
    }

    const pathname = new URL(request.url).pathname;
    if (isStaticAssetPath(pathname)) {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return applySecurityHeaders(response, performance.now() - start);
    }

    // 2. Global DDoS & Multi-User Burst Rate Limiting
    const clientIp = extractClientIp(request);
    const clientFp = extractClientFingerprint(request);
    const rate = checkRateLimit(clientFp, "global");
    if (!rate.ok) {
      return buildSecurityRejectionResponse(request, 429, rate.reason ?? "Rate limit exceeded.", {
        "retry-after": String(rate.retryAfterSeconds),
        "x-ratelimit-limit": String(rate.limit),
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": String(rate.resetEpochSeconds),
      });
    }

    // 3. Multi-User Single-Time Concurrency Semaphore
    const slot = acquireConcurrencySlot(clientIp, "global");
    if (!slot.ok) {
      return buildSecurityRejectionResponse(
        request,
        429,
        slot.reason ?? "Too many simultaneous requests.",
        { "retry-after": "3" },
      );
    }

    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      const normalized = await normalizeCatastrophicSsrResponse(response);
      return applySecurityHeaders(normalized, performance.now() - start);
    } catch (error) {
      console.error(error);
      return applySecurityHeaders(
        new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
        performance.now() - start,
      );
    } finally {
      slot.release();
    }
  },
};
