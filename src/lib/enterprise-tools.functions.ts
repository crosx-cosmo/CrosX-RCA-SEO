import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { parseMigrationInput, type MigrationParseResult } from "./migration-parser";

async function withServerToolGuard<T>(fn: () => Promise<T>): Promise<T> {
  const { acquireConcurrencySlot, checkRateLimit, extractClientFingerprint, extractClientIp } =
    await import("./security.server");
  let req: Request | null = null;
  try {
    req = getRequest();
  } catch {
    req = null;
  }
  const fp = extractClientFingerprint(req);
  const ip = extractClientIp(req);
  const limit = checkRateLimit(fp, "public-api");
  if (!limit.ok) {
    throw new Error(limit.reason ?? "Rate limit exceeded. Please wait a moment.");
  }
  const slot = acquireConcurrencySlot(ip, "public-api");
  if (!slot.ok) {
    throw new Error(slot.reason ?? "Too many concurrent operations.");
  }
  try {
    return await fn();
  } finally {
    slot.release();
  }
}

export const fetchRemoteSitemap = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        sitemapUrl: z.string().trim().url().max(2048),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<MigrationParseResult> =>
    withServerToolGuard(async () => {
      const { assertSafeUrl } = await import("./trace-ssrf.server");
      const safety = await assertSafeUrl(data.sitemapUrl);
      if (!safety.ok) {
        throw new Error(safety.reason ?? "Unsafe sitemap URL blocked by SSRF policy.");
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch(data.sitemapUrl, {
          method: "GET",
          redirect: "follow",
          signal: controller.signal,
          headers: {
            "user-agent":
              "Mozilla/5.0 (compatible; CROSX-SitemapAuditor/1.0; +https://rca.crosx.in)",
            accept: "application/xml,text/xml,text/plain;q=0.9,*/*;q=0.8",
          },
        });
        if (!res.ok) {
          throw new Error(`Sitemap request returned HTTP ${res.status}`);
        }
        const text = (await res.text()).slice(0, 500_000);
        const origin = new URL(data.sitemapUrl).origin;
        return parseMigrationInput(text, origin, 20);
      } finally {
        clearTimeout(timer);
      }
    }),
  );

export const dispatchMonitorWebhook = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        webhookUrl: z.string().trim().url().max(2048),
        payload: z.record(z.unknown()),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<{ ok: boolean; status: number }> =>
    withServerToolGuard(async () => {
      const { assertSafeUrl } = await import("./trace-ssrf.server");
      const safety = await assertSafeUrl(data.webhookUrl);
      if (!safety.ok) {
        throw new Error(safety.reason ?? "Webhook URL blocked by SSRF security policy.");
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      try {
        const res = await fetch(data.webhookUrl, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "content-type": "application/json",
            "user-agent": "CROSX-RedirectMonitor-Webhook/1.0 (+https://rca.crosx.in)",
          },
          body: JSON.stringify(data.payload),
        });
        return { ok: res.ok, status: res.status };
      } finally {
        clearTimeout(timer);
      }
    }),
  );
