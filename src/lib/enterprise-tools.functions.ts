import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { parseMigrationInput, type MigrationParseResult } from "./migration-parser";

const MAX_WEBHOOK_PAYLOAD_BYTES = 32_768;

async function withServerToolGuard<T>(fn: () => Promise<T>): Promise<T> {
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
      const { readBoundedText, safeFetchWithRedirects } = await import("./trace-ssrf.server");
      const { response: res, finalUrl } = await safeFetchWithRedirects(
        data.sitemapUrl,
        {
          method: "GET",
          headers: {
            "user-agent":
              "Mozilla/5.0 (compatible; CROSX-SitemapAuditor/1.0; +https://rca.crosx.in)",
            accept: "application/xml,text/xml,text/plain;q=0.9,*/*;q=0.8",
          },
        },
        { maxHops: 5, timeoutMs: 8000 },
      );

      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        throw new Error(`Sitemap request returned HTTP ${res.status}`);
      }
      const text = await readBoundedText(res, 500_000);
      const origin = new URL(finalUrl).origin;
      return parseMigrationInput(text, origin, 20);
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
      const bodyStr = JSON.stringify(data.payload);
      if (bodyStr.length > MAX_WEBHOOK_PAYLOAD_BYTES) {
        throw new Error("Webhook payload exceeds maximum safe size (32 KB).");
      }

      const { safeFetchWithRedirects } = await import("./trace-ssrf.server");
      const { response: res } = await safeFetchWithRedirects(
        data.webhookUrl,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "user-agent": "CROSX-RedirectMonitor-Webhook/1.0 (+https://rca.crosx.in)",
          },
          body: bodyStr,
        },
        { maxHops: 0, timeoutMs: 6000 },
      );
      await res.body?.cancel().catch(() => {});
      return { ok: res.ok, status: res.status };
    }),
  );
