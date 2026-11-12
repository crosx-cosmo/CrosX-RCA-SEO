import { createServerFn } from "@tanstack/react-start";
import { getRequest, getRequestHost } from "@tanstack/react-start/server";
import { z } from "zod";

import { MAX_CONDITIONS, MAX_RULES, type LinkRule } from "./link-rules";

export interface ShortLink {
  id: string;
  slug: string;
  destination: string;
  enabled: boolean;
  clicks: number;
  last_clicked_at: string | null;
  created_at: string;
  expires_at: string | null;
  rules?: LinkRule[];
}

const owner = z.string().regex(/^[A-Za-z0-9-]{32,128}$/, "Invalid owner token");
const SLUG_RE = /^[A-Za-z0-9_-]{3,40}$/;
const RESERVED = new Set(["api", "admin", "links", "s", "r", "api-docs", "login", "www"]);

function dbError(message: string): Error {
  if (/fetch failed|ENOTFOUND|resolve/i.test(message)) {
    return new Error("The links database is currently unreachable. Please try again later.");
  }
  return new Error(message);
}

function randomSlug(): string {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(7));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

async function withShortLinkGuard<T>(
  tier: "shortlink-write" | "shortlink-read",
  fn: () => Promise<T>,
): Promise<T> {
  const {
    acquireConcurrencySlot,
    checkRateLimit,
    extractClientFingerprint,
    extractClientIp,
    inspectIncomingRequest,
  } = await import("./security.server");
  let req: Request | null = null;
  try {
    req = getRequest();
  } catch {
    req = null;
  }
  if (req) {
    const waf = inspectIncomingRequest(req);
    if (!waf.ok) {
      throw new Error(waf.reason ?? "Request blocked by security policy.");
    }
  }
  const fp = extractClientFingerprint(req);
  const ip = extractClientIp(req);
  const limit = checkRateLimit(fp, tier);
  if (!limit.ok) {
    throw new Error(limit.reason ?? "Too many short link actions. Please wait a moment.");
  }
  const slot = acquireConcurrencySlot(ip, tier);
  if (!slot.ok) {
    throw new Error(slot.reason ?? "Too many simultaneous short link operations.");
  }
  try {
    return await fn();
  } finally {
    slot.release();
  }
}

function withShortLinkWriteGuard<T>(fn: () => Promise<T>): Promise<T> {
  return withShortLinkGuard("shortlink-write", fn);
}

function withShortLinkReadGuard<T>(fn: () => Promise<T>): Promise<T> {
  return withShortLinkGuard("shortlink-read", fn);
}

export const createShortLink = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        destination: z.string().trim().min(1).max(2048),
        slug: z.string().trim().max(40).optional(),
        owner,
      })
      .parse(d),
  )
  .handler(async ({ data }) =>
    withShortLinkWriteGuard(async () => {
      const { shortLinkDb, validateDestination } = await import("./shortlinks.server");
      const problem = await validateDestination(data.destination, getRequestHost());
      if (problem) throw new Error(problem);

      const custom = data.slug || "";
      if (custom && (!SLUG_RE.test(custom) || RESERVED.has(custom.toLowerCase()))) {
        throw new Error("Slug must be 3–40 letters, numbers, - or _, and not a reserved word.");
      }
      const db = shortLinkDb();
      for (let attempt = 0; attempt < (custom ? 1 : 4); attempt++) {
        const slug = custom || randomSlug();
        const { data: row, error } = await db.rpc("create_short_link", {
          p_slug: slug,
          p_destination: new URL(data.destination).toString(),
          p_owner: data.owner,
        });
        if (!error) return row as ShortLink;
        if (error.code === "23505") {
          if (custom) throw new Error("That slug is already taken.");
          continue;
        }
        throw dbError(error.message);
      }
      throw new Error("Could not generate a unique slug. Try again.");
    }),
  );

export const listShortLinks = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ owner }).parse(d))
  .handler(async ({ data }) =>
    withShortLinkReadGuard(async () => {
      const { shortLinkDb } = await import("./shortlinks.server");
      const { data: rows, error } = await shortLinkDb().rpc("list_short_links", {
        p_owner: data.owner,
      });
      if (error) throw dbError(error.message);
      return (rows ?? []) as ShortLink[];
    }),
  );

export const setShortLinkEnabled = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ id: z.string().uuid(), enabled: z.boolean(), owner }).parse(d))
  .handler(async ({ data }) =>
    withShortLinkWriteGuard(async () => {
      const { shortLinkDb } = await import("./shortlinks.server");
      const { error } = await shortLinkDb().rpc("set_short_link_enabled", {
        p_id: data.id,
        p_owner: data.owner,
        p_enabled: data.enabled,
      });
      if (error) throw dbError(error.message);
      return { ok: true };
    }),
  );

export const deleteShortLink = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ id: z.string().uuid(), owner }).parse(d))
  .handler(async ({ data }) =>
    withShortLinkWriteGuard(async () => {
      const { shortLinkDb } = await import("./shortlinks.server");
      const { error } = await shortLinkDb().rpc("delete_short_link", {
        p_id: data.id,
        p_owner: data.owner,
      });
      if (error) throw dbError(error.message);
      return { ok: true };
    }),
  );

export const updateShortLinkDestination = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({ id: z.string().uuid(), destination: z.string().trim().min(1).max(2048), owner })
      .parse(d),
  )
  .handler(async ({ data }) =>
    withShortLinkWriteGuard(async () => {
      const { shortLinkDb, validateDestination } = await import("./shortlinks.server");
      const problem = await validateDestination(data.destination, getRequestHost());
      if (problem) throw new Error(problem);
      const { data: ok, error } = await shortLinkDb().rpc("update_short_link_destination", {
        p_id: data.id,
        p_owner: data.owner,
        p_destination: new URL(data.destination).toString(),
      });
      if (error) throw dbError(error.message);
      if (!ok) throw new Error("Link not found.");
      return { ok: true };
    }),
  );

export const setShortLinkExpiry = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        expiresAt: z.string().datetime({ offset: true }).nullable(),
        owner,
      })
      .parse(d),
  )
  .handler(async ({ data }) =>
    withShortLinkWriteGuard(async () => {
      if (data.expiresAt && new Date(data.expiresAt).getTime() <= Date.now()) {
        throw new Error("Expiry must be in the future.");
      }
      const { shortLinkDb } = await import("./shortlinks.server");
      const { data: ok, error } = await shortLinkDb().rpc("set_short_link_expiry", {
        p_id: data.id,
        p_owner: data.owner,
        p_expires_at: data.expiresAt,
      });
      if (error) throw dbError(error.message);
      if (!ok) throw new Error("Link not found.");
      return { ok: true };
    }),
  );

const ruleSchema = z.object({
  id: z.string().regex(/^[a-z0-9]{1,16}$/),
  name: z.string().trim().max(60),
  enabled: z.boolean(),
  match: z.enum(["all", "any"]),
  destination: z.string().trim().min(1).max(2048),
  conditions: z
    .array(
      z.object({
        field: z.enum([
          "country",
          "platform",
          "browser",
          "os",
          "query",
          "utm_source",
          "utm_medium",
          "utm_campaign",
          "weekday",
          "hour",
          "date",
          "ab_split",
        ]),
        op: z.enum(["is", "is_not", "contains", "between", "before", "after", "exists"]),
        value: z.string().trim().max(200),
      }),
    )
    .min(1)
    .max(MAX_CONDITIONS),
});

export const setShortLinkRules = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({ id: z.string().uuid(), rules: z.array(ruleSchema).max(MAX_RULES), owner }).parse(d),
  )
  .handler(async ({ data }) =>
    withShortLinkWriteGuard(async () => {
      const { shortLinkDb, validateDestination } = await import("./shortlinks.server");
      const host = getRequestHost();
      const rules: LinkRule[] = [];
      for (const r of data.rules) {
        const problem = await validateDestination(r.destination, host);
        if (problem) throw new Error(`Rule "${r.name || r.id}": ${problem}`);
        rules.push({ ...r, destination: new URL(r.destination).toString() });
      }
      const { data: ok, error } = await shortLinkDb().rpc("set_short_link_rules", {
        p_id: data.id,
        p_owner: data.owner,
        p_rules: rules as never,
      });
      if (error) throw dbError(error.message);
      if (!ok) throw new Error("Link not found.");
      return { ok: true };
    }),
  );

export interface Bucket {
  k: string;
  n: number;
}
export interface LinkAnalytics {
  total: number;
  unique: number;
  bots: number;
  timeline: { day: string; clicks: number; unique: number }[];
  referrers: Bucket[];
  countries: Bucket[];
  devices: Bucket[];
  browsers: Bucket[];
  os: Bucket[];
  utm: Bucket[];
  recent: {
    clicked_at: string;
    referrer_host: string | null;
    country: string | null;
    region: string | null;
    device: string | null;
    browser: string | null;
    os: string | null;
    utm_source: string | null;
    is_bot: boolean;
    rule_id: string | null;
  }[];
}

const range = z.object({
  id: z.string().uuid(),
  owner,
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
});

export const getLinkAnalytics = createServerFn({ method: "POST" })
  .inputValidator((d) => range.parse(d))
  .handler(async ({ data }) =>
    withShortLinkReadGuard(async () => {
      const { shortLinkDb } = await import("./shortlinks.server");
      const { data: res, error } = await shortLinkDb().rpc("link_analytics", {
        p_id: data.id,
        p_owner: data.owner,
        p_from: data.from,
        p_to: data.to,
      });
      if (error) throw dbError(error.message);
      if (!res) throw new Error("Link not found.");
      return res as unknown as LinkAnalytics;
    }),
  );

export const exportLinkClicks = createServerFn({ method: "POST" })
  .inputValidator((d) => range.parse(d))
  .handler(async ({ data }) =>
    withShortLinkReadGuard(async () => {
      const { shortLinkDb } = await import("./shortlinks.server");
      const { data: rows, error } = await shortLinkDb().rpc("export_link_clicks", {
        p_id: data.id,
        p_owner: data.owner,
        p_from: data.from,
        p_to: data.to,
      });
      if (error) throw dbError(error.message);
      return (rows ?? []) as Record<string, string | boolean | null>[];
    }),
  );

export interface DestinationHealthResult {
  id: string;
  url: string;
  ok: boolean;
  status: number | null;
  statusText: string;
  latencyMs: number;
  finalUrl: string | null;
  error: string | null;
}

export const checkShortLinksHealth = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        owner,
        items: z
          .array(
            z.object({
              id: z.string().min(1).max(64),
              url: z.string().trim().min(1).max(2048),
            }),
          )
          .min(1)
          .max(20),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<DestinationHealthResult[]> =>
    withShortLinkWriteGuard(async () => {
      const { safeFetchWithRedirects } = await import("./trace-ssrf.server");
      const results = await Promise.all(
        data.items.map(async (item): Promise<DestinationHealthResult> => {
          const started = performance.now();
          try {
            const { response: res, finalUrl } = await safeFetchWithRedirects(
              item.url,
              {
                method: "GET",
                headers: {
                  "user-agent":
                    "Mozilla/5.0 (compatible; CROSX-LinkHealthCheck/1.0; +https://rca.crosx.in)",
                  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                },
              },
              { maxHops: 5, timeoutMs: 6000 },
            );
            try {
              await res.body?.cancel();
            } catch {
              // ignore
            }
            const latencyMs = Math.round(performance.now() - started);
            return {
              id: item.id,
              url: item.url,
              ok: res.status >= 200 && res.status < 400,
              status: res.status,
              statusText: res.statusText || (res.ok ? "OK" : `HTTP ${res.status}`),
              latencyMs,
              finalUrl: finalUrl || item.url,
              error: res.status >= 400 ? `HTTP ${res.status}` : null,
            };
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Connection failed";
            const isBlocked = /Blocked|SSRF|loop|private|internal|not allowed/i.test(msg);
            return {
              id: item.id,
              url: item.url,
              ok: false,
              status: null,
              statusText: isBlocked ? "Blocked" : "Unreachable",
              latencyMs: Math.round(performance.now() - started),
              finalUrl: null,
              error: msg,
            };
          }
        }),
      );
      return results;
    }),
  );
