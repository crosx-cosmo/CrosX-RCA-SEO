import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

import type { LinkRule } from "./link-rules";
import { SITE_HOST } from "./seo";
import { SUPABASE_DIRECT_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./supabase";
import { assertSafeUrl } from "./trace-ssrf.server";

export interface StoredShortLink {
  id: string;
  slug: string;
  destination: string;
  enabled: boolean;
  clicks: number;
  last_clicked_at: string | null;
  created_at: string;
  expires_at: string | null;
  rules: LinkRule[];
  owner_hash: string;
}

export interface StoredLinkClick {
  id: number;
  link_id: string;
  clicked_at: string;
  visitor_hash: string;
  referrer_host: string | null;
  country: string | null;
  region: string | null;
  device: string | null;
  browser: string | null;
  os: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  is_bot: boolean;
  rule_id: string | null;
}

interface LocalShortLinkStoreData {
  nextClickId: number;
  links: StoredShortLink[];
  clicks: StoredLinkClick[];
}

export interface RpcResult<T = unknown> {
  data: T | null;
  error: { message: string; code?: string } | null;
}

export interface ShortLinkDatabaseClient {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<RpcResult>;
}

const STORE_FILE_PATH = resolve(process.cwd(), ".data", "shortlinks-store.json");
const UPSTREAM_CIRCUIT_COOLDOWN_MS = 60_000;
const UPSTREAM_TIMEOUT_MS = 3_500;

let memoryStore: LocalShortLinkStoreData | null = null;
let upstreamCooldownUntil = 0;

function slHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function loadLocalStore(): LocalShortLinkStoreData {
  if (memoryStore) return memoryStore;
  try {
    if (existsSync(STORE_FILE_PATH)) {
      const raw = readFileSync(STORE_FILE_PATH, "utf8");
      const parsed = JSON.parse(raw) as Partial<LocalShortLinkStoreData>;
      memoryStore = {
        nextClickId: typeof parsed.nextClickId === "number" ? parsed.nextClickId : 1,
        links: Array.isArray(parsed.links) ? parsed.links : [],
        clicks: Array.isArray(parsed.clicks) ? parsed.clicks : [],
      };
      return memoryStore;
    }
  } catch {
    // Fall back to in-memory store if disk cannot be read
  }
  memoryStore = { nextClickId: 1, links: [], clicks: [] };
  return memoryStore;
}

function saveLocalStore(store: LocalShortLinkStoreData): void {
  memoryStore = store;
  try {
    const dir = dirname(STORE_FILE_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(STORE_FILE_PATH, JSON.stringify(store, null, 2), "utf8");
  } catch {
    // Read-only serverless filesystem fallback: keep in-memory state active
  }
}

function toPublicLink(row: StoredShortLink) {
  return {
    id: row.id,
    slug: row.slug,
    destination: row.destination,
    enabled: row.enabled,
    clicks: row.clicks,
    last_clicked_at: row.last_clicked_at,
    created_at: row.created_at,
    expires_at: row.expires_at,
    rules: Array.isArray(row.rules) ? row.rules : [],
  };
}

function topBuckets(values: (string | null | undefined)[], fallbackLabel: string) {
  const counts = new Map<string, number>();
  for (const raw of values) {
    const k = raw && raw.trim() ? raw.trim() : fallbackLabel;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([k, n]) => ({ k, n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 10);
}

/**
 * Executes the exact SQL/RPC procedures defined in supabase/short_links.sql
 * and drizzle/migrations/0000..0002 against the local store.
 */
export function executeLocalShortLinkRpc(
  fn: string,
  args: Record<string, unknown> = {},
): RpcResult {
  const store = loadLocalStore();

  switch (fn) {
    case "create_short_link": {
      const pSlug = String(args["p_slug"] ?? "").trim();
      const pDestination = String(args["p_destination"] ?? "").trim();
      const pOwner = String(args["p_owner"] ?? "");
      if (pOwner.length < 32) {
        return { data: null, error: { message: "invalid owner token" } };
      }
      if (store.links.some((l) => l.slug === pSlug)) {
        return {
          data: null,
          error: {
            code: "23505",
            message: 'duplicate key value violates unique constraint "short_links_slug_key"',
          },
        };
      }
      const created: StoredShortLink = {
        id: randomUUID(),
        slug: pSlug,
        destination: pDestination,
        enabled: true,
        clicks: 0,
        last_clicked_at: null,
        created_at: new Date().toISOString(),
        expires_at: null,
        rules: [],
        owner_hash: slHash(pOwner),
      };
      store.links.unshift(created);
      saveLocalStore(store);
      return { data: toPublicLink(created), error: null };
    }

    case "list_short_links": {
      const pOwner = String(args["p_owner"] ?? "");
      const ownerHash = slHash(pOwner);
      const rows = store.links
        .filter((l) => l.owner_hash === ownerHash)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, 500)
        .map(toPublicLink);
      return { data: rows, error: null };
    }

    case "set_short_link_enabled": {
      const pId = String(args["p_id"] ?? "");
      const pOwner = String(args["p_owner"] ?? "");
      const pEnabled = Boolean(args["p_enabled"]);
      const ownerHash = slHash(pOwner);
      const target = store.links.find((l) => l.id === pId && l.owner_hash === ownerHash);
      if (!target) return { data: false, error: null };
      target.enabled = pEnabled;
      saveLocalStore(store);
      return { data: true, error: null };
    }

    case "delete_short_link": {
      const pId = String(args["p_id"] ?? "");
      const pOwner = String(args["p_owner"] ?? "");
      const ownerHash = slHash(pOwner);
      const idx = store.links.findIndex((l) => l.id === pId && l.owner_hash === ownerHash);
      if (idx === -1) return { data: false, error: null };
      store.links.splice(idx, 1);
      store.clicks = store.clicks.filter((c) => c.link_id !== pId);
      saveLocalStore(store);
      return { data: true, error: null };
    }

    case "update_short_link_destination": {
      const pId = String(args["p_id"] ?? "");
      const pOwner = String(args["p_owner"] ?? "");
      const pDestination = String(args["p_destination"] ?? "");
      const ownerHash = slHash(pOwner);
      const target = store.links.find((l) => l.id === pId && l.owner_hash === ownerHash);
      if (!target) return { data: false, error: null };
      target.destination = pDestination;
      saveLocalStore(store);
      return { data: true, error: null };
    }

    case "set_short_link_expiry": {
      const pId = String(args["p_id"] ?? "");
      const pOwner = String(args["p_owner"] ?? "");
      const pExpiresAt = args["p_expires_at"] == null ? null : String(args["p_expires_at"]);
      const ownerHash = slHash(pOwner);
      const target = store.links.find((l) => l.id === pId && l.owner_hash === ownerHash);
      if (!target) return { data: false, error: null };
      target.expires_at = pExpiresAt;
      saveLocalStore(store);
      return { data: true, error: null };
    }

    case "set_short_link_rules": {
      const pId = String(args["p_id"] ?? "");
      const pOwner = String(args["p_owner"] ?? "");
      const pRules = Array.isArray(args["p_rules"]) ? (args["p_rules"] as LinkRule[]) : [];
      const ownerHash = slHash(pOwner);
      const target = store.links.find((l) => l.id === pId && l.owner_hash === ownerHash);
      if (!target) return { data: false, error: null };
      target.rules = pRules;
      saveLocalStore(store);
      return { data: true, error: null };
    }

    case "get_redirect_target": {
      const pSlug = String(args["p_slug"] ?? "");
      const now = Date.now();
      const target = store.links.find(
        (l) =>
          l.slug === pSlug &&
          l.enabled &&
          (!l.expires_at || new Date(l.expires_at).getTime() > now),
      );
      if (!target) return { data: [], error: null };
      return {
        data: [
          {
            id: target.id,
            destination: target.destination,
            rules: Array.isArray(target.rules) ? target.rules : [],
          },
        ],
        error: null,
      };
    }

    case "resolve_short_link": {
      const pSlug = String(args["p_slug"] ?? "");
      const now = Date.now();
      const target = store.links.find(
        (l) =>
          l.slug === pSlug &&
          l.enabled &&
          (!l.expires_at || new Date(l.expires_at).getTime() > now),
      );
      if (!target) return { data: null, error: null };
      target.clicks += 1;
      target.last_clicked_at = new Date().toISOString();
      saveLocalStore(store);
      return { data: target.destination, error: null };
    }

    case "record_link_click": {
      const pLinkId = String(args["p_link_id"] ?? "");
      const target = store.links.find((l) => l.id === pLinkId);
      if (!target) return { data: null, error: null };
      const nowIso = new Date().toISOString();
      target.clicks += 1;
      target.last_clicked_at = nowIso;
      store.clicks.unshift({
        id: store.nextClickId++,
        link_id: pLinkId,
        clicked_at: nowIso,
        visitor_hash: String(args["p_visitor"] ?? "").slice(0, 64),
        referrer_host: args["p_referrer"] != null ? String(args["p_referrer"]).slice(0, 120) : null,
        country: args["p_country"] != null ? String(args["p_country"]).slice(0, 8) : null,
        region: args["p_region"] != null ? String(args["p_region"]).slice(0, 80) : null,
        device: args["p_device"] != null ? String(args["p_device"]).slice(0, 20) : null,
        browser: args["p_browser"] != null ? String(args["p_browser"]).slice(0, 40) : null,
        os: args["p_os"] != null ? String(args["p_os"]).slice(0, 40) : null,
        utm_source:
          args["p_utm_source"] != null ? String(args["p_utm_source"]).slice(0, 100) : null,
        utm_medium:
          args["p_utm_medium"] != null ? String(args["p_utm_medium"]).slice(0, 100) : null,
        utm_campaign:
          args["p_utm_campaign"] != null ? String(args["p_utm_campaign"]).slice(0, 100) : null,
        is_bot: Boolean(args["p_is_bot"]),
        rule_id: args["p_rule"] != null ? String(args["p_rule"]).slice(0, 64) : null,
      });
      saveLocalStore(store);
      return { data: null, error: null };
    }

    case "link_analytics": {
      const pId = String(args["p_id"] ?? "");
      const pOwner = String(args["p_owner"] ?? "");
      const pFrom = new Date(String(args["p_from"] ?? 0)).getTime();
      const pTo = new Date(String(args["p_to"] ?? Date.now())).getTime();
      const ownerHash = slHash(pOwner);
      const owns = store.links.some((l) => l.id === pId && l.owner_hash === ownerHash);
      if (!owns) return { data: null, error: null };

      const matching = store.clicks.filter((c) => {
        if (c.link_id !== pId) return false;
        const ts = new Date(c.clicked_at).getTime();
        return ts >= pFrom && ts < pTo;
      });

      const byDay = new Map<string, { clicks: number; visitors: Set<string> }>();
      for (const c of matching) {
        const day = c.clicked_at.slice(0, 10);
        let entry = byDay.get(day);
        if (!entry) {
          entry = { clicks: 0, visitors: new Set() };
          byDay.set(day, entry);
        }
        entry.clicks += 1;
        entry.visitors.add(c.visitor_hash);
      }

      const timeline = Array.from(byDay.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([day, v]) => ({ day, clicks: v.clicks, unique: v.visitors.size }));

      const uniqueVisitors = new Set(matching.map((c) => c.visitor_hash)).size;
      const bots = matching.filter((c) => c.is_bot).length;

      return {
        data: {
          total: matching.length,
          unique: uniqueVisitors,
          bots,
          timeline,
          referrers: topBuckets(
            matching.map((c) => c.referrer_host),
            "Direct",
          ),
          countries: topBuckets(
            matching.map((c) => c.country),
            "Unknown",
          ),
          devices: topBuckets(
            matching.map((c) => c.device),
            "Unknown",
          ),
          browsers: topBuckets(
            matching.map((c) => c.browser),
            "Unknown",
          ),
          os: topBuckets(
            matching.map((c) => c.os),
            "Unknown",
          ),
          utm: topBuckets(
            matching.map(
              (c) =>
                (c.utm_source || "(none)") +
                (c.utm_medium ? ` / ${c.utm_medium}` : "") +
                (c.utm_campaign ? ` / ${c.utm_campaign}` : ""),
            ),
            "(none)",
          ),
          recent: matching
            .slice()
            .sort((a, b) => b.clicked_at.localeCompare(a.clicked_at))
            .slice(0, 25)
            .map((c) => ({
              clicked_at: c.clicked_at,
              referrer_host: c.referrer_host,
              country: c.country,
              region: c.region,
              device: c.device,
              browser: c.browser,
              os: c.os,
              utm_source: c.utm_source,
              is_bot: c.is_bot,
              rule_id: c.rule_id,
            })),
        },
        error: null,
      };
    }

    case "export_link_clicks": {
      const pId = String(args["p_id"] ?? "");
      const pOwner = String(args["p_owner"] ?? "");
      const pFrom = new Date(String(args["p_from"] ?? 0)).getTime();
      const pTo = new Date(String(args["p_to"] ?? Date.now())).getTime();
      const ownerHash = slHash(pOwner);
      const owns = store.links.some((l) => l.id === pId && l.owner_hash === ownerHash);
      if (!owns) return { data: [], error: null };

      const rows = store.clicks
        .filter((c) => {
          if (c.link_id !== pId) return false;
          const ts = new Date(c.clicked_at).getTime();
          return ts >= pFrom && ts < pTo;
        })
        .sort((a, b) => b.clicked_at.localeCompare(a.clicked_at))
        .slice(0, 10_000)
        .map((c) => ({
          clicked_at: c.clicked_at,
          referrer_host: c.referrer_host,
          country: c.country,
          region: c.region,
          device: c.device,
          browser: c.browser,
          os: c.os,
          utm_source: c.utm_source,
          utm_medium: c.utm_medium,
          utm_campaign: c.utm_campaign,
          is_bot: c.is_bot,
          rule_id: c.rule_id,
        }));
      return { data: rows, error: null };
    }

    default:
      return { data: null, error: { message: `Unsupported RPC function: ${fn}` } };
  }
}

export function isUpstreamOriginError(message: string): boolean {
  return /error code:\s*1016|error code:\s*10\d\d|530|52\d|502|503|504|fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|network|resolve| aborted/i.test(
    message,
  );
}

function createSupabaseRestClient(baseUrl: string, key: string) {
  return createClient(baseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
        h.set("apikey", key);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
        return fetch(input, {
          ...init,
          headers: h,
          signal: init?.signal ?? controller.signal,
        }).finally(() => clearTimeout(timer));
      },
    },
  });
}

export function shortLinkDb(): ShortLinkDatabaseClient {
  const key = SUPABASE_PUBLISHABLE_KEY;
  const candidateUrls = Array.from(new Set([SUPABASE_URL, SUPABASE_DIRECT_URL].filter(Boolean)));

  return {
    async rpc(fn: string, args: Record<string, unknown> = {}): Promise<RpcResult> {
      if (key && candidateUrls.length > 0 && Date.now() >= upstreamCooldownUntil) {
        let lastError: { message: string; code?: string } | null = null;
        for (const url of candidateUrls) {
          try {
            const client = createSupabaseRestClient(url, key);
            const { data, error } = await client.rpc(fn, args);
            if (!error) {
              return { data, error: null };
            }
            if (!isUpstreamOriginError(error.message)) {
              return {
                data: null,
                error: { message: error.message, code: error.code },
              };
            }
            lastError = { message: error.message, code: error.code };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (!isUpstreamOriginError(msg)) {
              return { data: null, error: { message: msg } };
            }
            lastError = { message: msg };
          }
        }
        if (lastError) {
          upstreamCooldownUntil = Date.now() + UPSTREAM_CIRCUIT_COOLDOWN_MS;
        }
      }

      return executeLocalShortLinkRpc(fn, args);
    },
  };
}

/** Validates a destination before storing or redirecting. Returns an error message or null. */
export async function validateDestination(raw: string, selfHost?: string): Promise<string | null> {
  if (raw.length > 2048) return "URL is too long (max 2048 characters).";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "Enter a full URL starting with http:// or https://.";
  }
  if (url.username || url.password) return "URLs with embedded credentials are not allowed.";
  const targetHost = url.host.toLowerCase();
  const isSelfShortLink =
    url.pathname.startsWith("/s/") &&
    (targetHost === SITE_HOST.toLowerCase() ||
      Boolean(selfHost && targetHost === selfHost.toLowerCase()));
  if (isSelfShortLink) {
    return "A short link cannot point to another short link on this site.";
  }
  const verdict = await assertSafeUrl(url.toString());
  return verdict.ok ? null : (verdict.reason ?? "This destination is not allowed.");
}
