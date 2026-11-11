/**
 * Sandboxed Headless-Browser Redirect & Dynamic JS Trace Engine (server-only).
 *
 * Resolves pages that navigate via computed JavaScript, SPA routers, external
 * script bundles, timer countdowns, or anti-bot interstitials using:
 *  1. Local sandboxed Chromium via `playwright-core` (with per-request SSRF
 *     interception via `assertSafeUrl`, accelerated timers, and popup capture).
 *  2. Remote Browserless service if `BROWSERLESS_TOKEN` is configured.
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { assertSafeUrl } from "./trace-ssrf.server";

export interface BrowserHopNavigation {
  url: string;
  status: number | null;
  method: string;
  ms: number;
}

export interface BrowserTraceResult {
  ok: boolean;
  /** Why the fallback could not run / did not resolve anything. */
  reason: string | null;
  finalUrl: string | null;
  finalStatus?: number | null;
  finalHtml?: string | null;
  navigations: BrowserHopNavigation[];
  elapsedMs: number;
}

const GLOBAL_PW_PATH = "/usr/local/share/bun-global/node_modules/playwright-core";
const HEADLESS_SHELL_PATHS = [
  "/ms-playwright/chrome-headless-shell-linux64/chrome-headless-shell",
  "/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell",
];

interface PwFrame {
  url: () => string;
}

interface PwResponse {
  frame: () => PwFrame;
  status: () => number;
  url: () => string;
}

interface PwRoute {
  request: () => { url: () => string; resourceType: () => string };
  abort: () => Promise<void>;
  continue: () => Promise<void>;
}

interface PwPage {
  mainFrame: () => PwFrame;
  on: {
    (event: "response", listener: (res: PwResponse) => void): void;
    (event: "framenavigated", listener: (frame: PwFrame) => void): void;
  };
  goto: (url: string, opts: { waitUntil: string; timeout: number }) => Promise<unknown>;
  url: () => string;
  waitForTimeout: (ms: number) => Promise<void>;
  waitForLoadState: (state: string, opts: { timeout: number }) => Promise<void>;
  content: () => Promise<string>;
}

interface PwContext {
  addInitScript: (script: string) => Promise<void>;
  route: (pattern: string, handler: (route: PwRoute) => Promise<void>) => Promise<void>;
  newPage: () => Promise<PwPage>;
  close: () => Promise<void>;
}

interface PwBrowser {
  newContext: (opts: Record<string, unknown>) => Promise<PwContext>;
  close: () => Promise<void>;
}

function loadLocalPlaywright(): {
  chromium: {
    executablePath: (opts?: Record<string, unknown>) => string;
    launch: (opts: Record<string, unknown>) => Promise<PwBrowser>;
  };
} | null {
  try {
    const req = createRequire(path.join(process.cwd(), "package.json"));
    if (fs.existsSync(GLOBAL_PW_PATH)) {
      return req(GLOBAL_PW_PATH);
    }
    return req("playwright-core");
  } catch {
    return null;
  }
}

export function browserFallbackConfigured(): boolean {
  if (process.env["BROWSERLESS_TOKEN"]) return true;
  const pw = loadLocalPlaywright();
  if (!pw) return false;
  try {
    if (HEADLESS_SHELL_PATHS.some((p) => fs.existsSync(p))) {
      return true;
    }
    const execPath = pw.chromium.executablePath();
    return Boolean(execPath && fs.existsSync(execPath));
  } catch {
    return false;
  }
}

async function traceWithLocalChromium(
  url: string,
  timeoutMs: number,
  userAgent?: string,
): Promise<BrowserTraceResult | null> {
  const pw = loadLocalPlaywright();
  if (!pw) return null;

  const started = Date.now();
  const navigations: BrowserHopNavigation[] = [];
  let browser: PwBrowser | null = null;

  try {
    browser = await pw.chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-extensions",
      ],
    });

    const context = await browser.newContext({
      userAgent:
        userAgent ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      ignoreHTTPSErrors: true,
      javaScriptEnabled: true,
    });

    // Accelerate long countdown timers (e.g. 5s/10s interstitial timers -> 60ms)
    // and redirect window.open() calls into main-frame navigation so popup redirects are captured.
    await context.addInitScript(`
      (() => {
        const origSetTimeout = window.setTimeout;
        window.setTimeout = function(fn, delay, ...args) {
          const capped = typeof delay === 'number' && delay > 150 ? 60 : delay;
          return origSetTimeout.call(window, fn, capped, ...args);
        };
        window.open = function(targetUrl) {
          if (typeof targetUrl === 'string' && targetUrl.trim()) {
            window.location.href = targetUrl;
          }
          return null;
        };
      })();
    `);

    // Enforce SSRF protection on EVERY network request inside the headless browser
    const hostSafetyCache = new Map<string, { ok: boolean; reason: string | null }>();
    await context.route("**/*", async (route: PwRoute) => {
      const req = route.request();
      const reqUrl = req.url();
      const resourceType = req.resourceType();

      // Block heavy media/fonts/images to speed up redirect resolution
      if (resourceType === "image" || resourceType === "media" || resourceType === "font") {
        await route.abort().catch(() => {});
        return;
      }

      if (!/^https?:\/\//i.test(reqUrl)) {
        await route.abort().catch(() => {});
        return;
      }

      let hostKey = reqUrl;
      try {
        hostKey = new URL(reqUrl).origin;
      } catch {
        await route.abort().catch(() => {});
        return;
      }

      let safety = hostSafetyCache.get(hostKey);
      if (!safety) {
        const v = await assertSafeUrl(reqUrl, 3000);
        safety = { ok: v.ok, reason: v.reason };
        hostSafetyCache.set(hostKey, safety);
      }

      if (!safety.ok) {
        await route.abort().catch(() => {});
        return;
      }

      await route.continue().catch(() => {});
    });

    const page = await context.newPage();
    let lastMainStatus: number | null = null;

    page.on("response", (res: PwResponse) => {
      try {
        if (res.frame() === page.mainFrame()) {
          const st = res.status();
          lastMainStatus = st;
          const resUrl = res.url();
          if (st >= 300 && st < 400) {
            navigations.push({
              url: resUrl,
              status: st,
              method: `HTTP ${st} redirect in browser`,
              ms: Date.now() - started,
            });
          }
        }
      } catch {
        // ignore
      }
    });

    page.on("framenavigated", (frame: PwFrame) => {
      try {
        if (frame === page.mainFrame()) {
          const navUrl = frame.url();
          if (navUrl && /^https?:\/\//i.test(navUrl)) {
            const prev = navigations[navigations.length - 1];
            if (!prev || prev.url !== navUrl) {
              navigations.push({
                url: navUrl,
                status: lastMainStatus,
                method: "Browser frame navigation",
                ms: Date.now() - started,
              });
            }
          }
        }
      } catch {
        // ignore
      }
    });

    const navTimeout = Math.max(4000, Math.min(18_000, timeoutMs - 1500));
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: navTimeout }).catch(() => {});

    // Give accelerated timers / JS redirects / meta refresh a moment to settle
    const initialUrl = page.url();
    for (let step = 0; step < 6; step++) {
      await page.waitForTimeout(220).catch(() => {});
      if (page.url() !== initialUrl && page.url() !== url) {
        // Wait briefly for the new page to settle
        await page.waitForLoadState("domcontentloaded", { timeout: 2500 }).catch(() => {});
        break;
      }
    }

    const finalUrl = page.url();
    const finalHtml = await page.content().catch(() => null);

    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    browser = null;

    return {
      ok: Boolean(finalUrl && /^https?:\/\//i.test(finalUrl)),
      reason: null,
      finalUrl: finalUrl || null,
      finalStatus: lastMainStatus,
      finalHtml,
      navigations,
      elapsedMs: Date.now() - started,
    };
  } catch (err) {
    if (browser) {
      await browser.close().catch(() => {});
    }
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Local headless browser failed",
      finalUrl: null,
      navigations,
      elapsedMs: Date.now() - started,
    };
  }
}

const RENDER_SCRIPT = `
export default async function ({ page, context }) {
  const navigations = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations.push({ url: frame.url(), status: 200, method: 'Browser navigation', ms: Date.now() });
  });
  await page.goto(context.url, { waitUntil: 'networkidle2', timeout: context.timeout });
  await page.waitForTimeout(1500).catch(() => {});
  return {
    data: { finalUrl: page.url(), navigations },
    type: 'application/json',
  };
}
`;

export async function traceWithBrowser(
  url: string,
  timeoutMs: number,
  userAgent?: string,
): Promise<BrowserTraceResult> {
  // 1. Try local sandboxed Chromium first (fast, zero external token needed)
  const localResult = await traceWithLocalChromium(url, timeoutMs, userAgent);
  if (localResult && localResult.ok) {
    return localResult;
  }

  // 2. Fallback to remote Browserless if configured
  const started = Date.now();
  const token = process.env["BROWSERLESS_TOKEN"];
  if (!token) {
    return (
      localResult ?? {
        ok: false,
        reason:
          "This page navigates with computed JavaScript and no headless browser runtime was available.",
        finalUrl: null,
        navigations: [],
        elapsedMs: 0,
      }
    );
  }

  const base = process.env["BROWSERLESS_BASE_URL"] ?? "https://production-sfo.browserless.io";

  const redactSecret = (msg: string) =>
    msg
      .replaceAll(token, "[REDACTED]")
      .replaceAll(encodeURIComponent(token), "[REDACTED]")
      .replace(/token=[^&\s]+/gi, "token=[REDACTED]");

  try {
    const response = await fetch(
      `${base.replace(/\/$/, "")}/function?token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: RENDER_SCRIPT,
          context: { url, timeout: Math.max(5000, timeoutMs - 2000) },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      },
    );

    if (!response.ok) {
      const detail = redactSecret((await response.text().catch(() => "")).slice(0, 200));
      return {
        ok: false,
        reason: `Headless-browser fallback failed with ${response.status}${detail ? `: ${detail}` : ""}.`,
        finalUrl: null,
        navigations: [],
        elapsedMs: Date.now() - started,
      };
    }

    const payload = (await response.json()) as {
      data?: { finalUrl?: string; navigations?: BrowserHopNavigation[] };
      finalUrl?: string;
    };
    const finalUrl = payload.data?.finalUrl ?? payload.finalUrl ?? null;
    if (!finalUrl) {
      return {
        ok: false,
        reason: "The headless browser returned no final URL for this page.",
        finalUrl: null,
        navigations: [],
        elapsedMs: Date.now() - started,
      };
    }
    return {
      ok: true,
      reason: null,
      finalUrl,
      navigations: payload.data?.navigations ?? [],
      elapsedMs: Date.now() - started,
    };
  } catch (error) {
    const rawMsg = error instanceof Error ? error.message : "unknown error";
    return {
      ok: false,
      reason: `Headless-browser fallback error: ${redactSecret(rawMsg)}.`,
      finalUrl: null,
      navigations: [],
      elapsedMs: Date.now() - started,
    };
  }
}
