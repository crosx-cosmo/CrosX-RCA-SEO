import { createFileRoute } from "@tanstack/react-router";

import { evaluateRules, parseUserAgent, type LinkRule } from "@/lib/link-rules";

const escapeHtml = (str: string) =>
  str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const page = (status: number, msg: string) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><title>Short link</title><body style="font-family:system-ui;padding:3rem;text-align:center"><h1>${status}</h1><p>${escapeHtml(msg)}</p><a href="/">Redirect Chain Analyzer</a></body>`,
    {
      status,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
        "x-robots-tag": "noindex, nofollow",
        "content-security-policy":
          "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      },
    },
  );

let ephemeralSaltBytes: Uint8Array<ArrayBuffer> | null = null;

function getVisitorSaltBytes(): Uint8Array<ArrayBuffer> {
  const envSalt =
    typeof process !== "undefined" ? process.env["VISITOR_HASH_SALT"]?.trim() : undefined;
  if (envSalt) {
    const encoded = new TextEncoder().encode(envSalt);
    return new Uint8Array(encoded);
  }
  if (!ephemeralSaltBytes) {
    const buf = new Uint8Array(new ArrayBuffer(32));
    ephemeralSaltBytes = crypto.getRandomValues(buf);
  }
  return ephemeralSaltBytes;
}

async function hashVisitor(text: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    getVisitorSaltBytes(),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(text));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const Route = createFileRoute("/s/$slug")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        if (!/^[A-Za-z0-9_-]{3,40}$/.test(params.slug)) return page(404, "Short link not found.");
        const [
          { shortLinkDb, validateDestination },
          {
            acquireConcurrencySlot,
            checkRateLimit,
            coalesceInFlight,
            extractClientFingerprint,
            extractClientIp,
          },
        ] = await Promise.all([import("@/lib/shortlinks.server"), import("@/lib/security.server")]);

        const ip = extractClientIp(request);
        const fp = extractClientFingerprint(request);
        const rate = checkRateLimit(fp, "shortlink-redirect");
        if (!rate.ok) {
          return page(429, rate.reason ?? "Too many redirect requests. Please try again shortly.");
        }

        const slot = acquireConcurrencySlot(ip, "shortlink-redirect");
        if (!slot.ok) {
          return page(429, slot.reason ?? "Too many simultaneous redirect requests.");
        }

        try {
          const db = shortLinkDb();
          const { data, error } = await coalesceInFlight(`redirect-target:${params.slug}`, () =>
            db.rpc("get_redirect_target", { p_slug: params.slug }),
          );
          if (error) return page(503, "Short links are temporarily unavailable.");
          const link = (Array.isArray(data) ? data[0] : null) as {
            id: string;
            destination: string;
            rules?: unknown;
          } | null;
          if (!link) return page(404, "This short link does not exist or has been disabled.");

          const reqUrl = new URL(request.url);
          const host = reqUrl.host;
          const ua = request.headers.get("user-agent") ?? "";
          const parsed = parseUserAgent(ua);
          const country = (request.headers.get("cf-ipcountry") ?? "").toUpperCase() || null;
          const region = request.headers.get("cf-region") ?? null;
          const query = Object.fromEntries(reqUrl.searchParams.entries());

          // Smart rules: first matching enabled rule wins; otherwise the default destination.
          const rules = (Array.isArray(link.rules) ? link.rules : []) as unknown as LinkRule[];
          const rule = rules.length
            ? evaluateRules(rules, {
                country: country && country !== "XX" ? country : null,
                platform: parsed.platform,
                browser: parsed.browser,
                os: parsed.os,
                query,
                now: new Date(),
              })
            : null;

          let destination = link.destination;
          let ruleId: string | null = null;
          if (rule && !(await validateDestination(rule.destination, host))) {
            destination = rule.destination;
            ruleId = rule.id;
          } else {
            // Re-validate at redirect time so a destination can never become an open redirect to internal hosts.
            const problem = await validateDestination(destination, host);
            if (problem) return page(410, "This short link's destination is no longer allowed.");
          }

          let referrer: string | null = null;
          try {
            const r = request.headers.get("referer");
            if (r) referrer = new URL(r).hostname || null;
          } catch {
            referrer = null;
          }
          const day = new Date().toISOString().slice(0, 10);
          // Privacy: only a daily-rotating HMAC-SHA256 of IP + UA is stored, never the IP itself.
          const visitor = await hashVisitor(`${ip}|${ua}|${day}|${link.id}`);
          await db.rpc("record_link_click", {
            p_link_id: link.id,
            p_visitor: visitor,
            p_referrer: referrer as string,
            p_country: (country && country !== "XX" ? country : null) as string,
            p_region: region as string,
            p_device: parsed.device,
            p_browser: parsed.browser,
            p_os: parsed.os,
            p_utm_source: (query["utm_source"] ?? null) as string,
            p_utm_medium: (query["utm_medium"] ?? null) as string,
            p_utm_campaign: (query["utm_campaign"] ?? null) as string,
            p_is_bot: parsed.isBot,
            p_rule: ruleId as string,
          });

          return new Response(null, {
            status: 302,
            headers: {
              location: destination,
              "cache-control": "no-store",
              "referrer-policy": "strict-origin-when-cross-origin",
              "x-robots-tag": "noindex",
            },
          });
        } finally {
          slot.release();
        }
      },
    },
  },
});
