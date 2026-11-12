# Chain Tracer

First Of All Inspections The Current GitHub Repo That Built In Another's Lovable Project : - https://github.com/crosx-cosmo/rca-crosx



Then : - UPGRADE REDIRECT CHAIN ANALYZER INTO A UNIVERSAL REDIRECT + URL TRACE ENGINE.



Keep the existing premium UI, branding, Light/Dark mode and all current features.



Make the analyzer capable of tracing as many real-world redirect mechanisms as safely possible:



- HTTP 301/302/303/307/308 Location redirects

- JavaScript redirects: window.location, location.href, location.replace, assign, meta/programmatic navigation

- HTML Meta Refresh

- Client-side/browser navigation

- Multi-hop and mixed redirect chains

- Affiliate/tracking redirects

- Redirect masking / cloaked tracking URLs

- HTTP → HTTPS and HTTPS → HTTP transitions

- Query-parameter additions, removals and modifications

- URL shorteners and tracking domains

- Detect redirect loops, chains, dead ends, timeouts and 4xx/5xx responses

- Detect when a 200 response actually contains a client-side redirect

- Continue tracing after detecting a client-side redirect until the true final destination



ARCHITECTURE:

Use server-side tracing for HTTP requests and a controlled headless-browser fallback for client-side/JavaScript redirects. Do not rely on browser-side fetch/CORS.



Security is mandatory:

- Strict SSRF protection

- Block localhost/private/reserved IP ranges

- Validate every destination before following it

- Limit maximum hops

- Per-hop timeout

- Overall analysis timeout

- Prevent infinite loops

- Do not execute arbitrary user-provided code outside the isolated browser context



Return a unified chain to the existing frontend with:

URL → mechanism → status → destination → timing → headers → detected parameters → final destination.



Clearly label each hop:

HTTP Redirect / JavaScript Redirect / Meta Refresh / Browser Navigation / Final Response.



If a redirect cannot be safely followed, show the exact reason instead of falsely reporting the chain as complete.



Do not fake results. Build the real tracing capability and connect it to the existing analyzer UI.

---

## Technology Stack

This section documents the complete, verified technology stack, runtime architecture, libraries, and engineering implementations powering the **CROSX Redirect Chain Analyzer** (`tanstack_start_ts`). All package names, versions, modules, and configurations listed below are verified directly against `package.json`, `tsconfig.json`, `vite.config.ts`, `drizzle.config.ts`, `eslint.config.js`, and the `/src` source tree.

---

### 1. Programming Languages

| Language | Standard / Dialect | Role in Project |
| :--- | :--- | :--- |
| **TypeScript** | `^5.8.3` (`target: "ES2022"`, `module: "ESNext"`, `strict: true`) | Primary language across all frontend components (`*.tsx`), isomorphic utilities (`*.ts`), TanStack Start server functions (`*.functions.ts`), and server-only engines (`*.server.ts`). |
| **JavaScript (ES2022 / ESM)** | `"type": "module"` | Native ECMAScript Modules used for runtime execution, build configuration (`eslint.config.js`), and inline theme initialization scripts. |
| **SQL / PL/pgSQL** | PostgreSQL (`pgcrypto`) | Database schema, Row-Level Security (RLS) policies, and `SECURITY DEFINER` RPC functions (`supabase/short_links.sql`). |
| **CSS** | CSS3 + Tailwind CSS v4 (`@theme inline`, OKLCH color space) | Design system tokens, light/dark mode custom properties, animations, and responsive layout utilities (`src/styles.css`). |
| **HTML5 / SVG / XML** | WHATWG HTML5, SVG 1.1, Sitemap XML 0.9 | SSR document shell (`src/routes/__root.tsx`), dynamic SVG flowchart/timeline generation (`src/lib/redirect-har.ts`), and XML crawl directives (`public/sitemap.xml`). |

---

### 2. Frontend Technologies & UI Frameworks

| Technology | Package & Version | Implementation Details |
| :--- | :--- | :--- |
| **React 19** | `react` (`^19.2.0`), `react-dom` (`^19.2.0`) | Core UI library using React 19 concurrent rendering, SSR streaming, hydration, and functional hooks (`useState`, `useMemo`, `useEffect`, `useCallback`, `useRef`). |
| **TanStack Start** | `@tanstack/react-start` (`1.168.60`) | Full-stack React framework providing isomorphic routing, Server-Side Rendering (SSR), `<HeadContent />` metadata management, and type-safe RPC server functions (`createServerFn`). |
| **TanStack Router** | `@tanstack/react-router` (`1.170.41`), `@tanstack/router-plugin` (`1.168.42`) | File-based type-safe router (`src/routeTree.gen.ts`) with `scrollRestoration: true` and `defaultPreload: "intent"`. Powers routes `/`, `/links`, `/api-docs`, `/r/$id`, `/s/$slug`, and `/api/public/trace`. |
| **Tailwind CSS v4** | `tailwindcss` (`^4.2.1`), `@tailwindcss/vite` (`^4.2.1`), `tw-animate-css` (`^1.3.4`) | Utility-first CSS engine configured via `@import "tailwindcss" source(none);` in `src/styles.css` with OKLCH color tokens and custom `@custom-variant dark` theming. |
| **shadcn/ui + Radix UI** | `style: "new-york"` (`components.json`) + 27 `@radix-ui/react-*` primitives | Accessible, unstyled UI primitives composed with `class-variance-authority` (`^0.7.1`), `clsx` (`^2.1.1`), and `tailwind-merge` (`^3.5.0`). |
| **Lucide Icons** | `lucide-react` (`^0.575.0`) | Vector iconography for HTTP status badges, hop mechanisms, security shields, and interactive controls. |
| **Sonner** | `sonner` (`^2.0.7`) | Toast notification system mounted in `src/routes/__root.tsx` for clipboard actions, webhook dispatches, and error feedback. |
| **QRCode** | `qrcode` (`^1.5.4`) | Client- and server-compatible QR code generator (PNG Data URL and SVG rendering) for short links (`src/routes/links.tsx`). |

---

### 3. Backend Technologies & Runtime Environment

| Component | Technology / Package | Implementation Details |
| :--- | :--- | :--- |
| **Server Runtime** | **Node.js** (`@types/node` `^22.16.5`) | Executes SSR rendering, TanStack Start server functions, raw HTTP hop tracing, DNS-over-HTTPS lookups, and local file fallback storage. |
| **Edge / Server Bundler** | **Nitro** (`nitro` `3.0.260603-beta`) | Bundles the server entry (`src/server.ts`) via `@lovable.dev/vite-tanstack-config` (`2.25.3`). |
| **Custom Server Entry** | `src/server.ts` (`@tanstack/react-start/server-entry`) | Intercepts every incoming HTTP `Request` before SSR to run the WAF inspector, DDoS burst rate limiter, per-IP/global concurrency semaphore, security header injector, and `h3` catastrophic 500 error normalizer. |
| **RPC Server Functions** | `createServerFn` (`@tanstack/react-start`) | Type-safe POST/GET RPC handlers in `src/lib/redirect.functions.ts`, `src/lib/shortlinks.functions.ts`, and `src/lib/enterprise-tools.functions.ts`. |
| **Public REST API** | `/api/public/trace` (`src/routes/api/public/trace.ts`) | Public JSON endpoint supporting `GET`, `POST`, and `OPTIONS` (CORS preflight), optional `Authorization: Bearer <REDIRECT_TRACER_API_KEY>` verification, and batch tracing (up to 5 URLs/request). |
| **Short-Link Redirector** | `/s/$slug` (`src/routes/s.$slug.ts`) | Server route handler issuing `302 Found` redirects with `Cache-Control: no-store`, deterministic A/B split bucket evaluation, smart conditional routing, and asynchronous click telemetry recording. |
| **Node Built-in Modules** | `node:crypto`, `node:fs`, `node:path`, `node:module`, `node:test`, `node:assert/strict` | Used in server-only modules for SHA-256 token hashing (`createHash`), UUID generation (`randomUUID`), local JSON store persistence (`.data/shortlinks-store.json`), dynamic `playwright-core` loading (`createRequire`), and unit testing. |

---

### 4. Core Libraries & Dependencies

#### Runtime Dependencies (`dependencies` in `package.json`)

| Package | Version | Purpose |
| :--- | :--- | :--- |
| `react` / `react-dom` | `^19.2.0` | Core React UI & DOM rendering |
| `@tanstack/react-start` | `1.168.60` | Full-stack SSR & RPC server functions |
| `@tanstack/react-router` | `1.170.41` | Type-safe file-based client/server routing |
| `@tanstack/router-plugin` | `1.168.42` | Route tree code generation plugin |
| `@tanstack/react-query` | `^5.101.1` | Async server-state caching and mutations |
| `@supabase/supabase-js` | `^2.117.2` | Supabase PostgreSQL & RPC client |
| `tailwindcss` / `@tailwindcss/vite` | `^4.2.1` | CSS framework and Vite v8 integration |
| `tw-animate-css` | `^1.3.4` | CSS keyframe and transition utilities |
| `zod` | `^3.24.2` | Runtime schema validation for RPCs and API payloads |
| `lucide-react` | `^0.575.0` | Icon library |
| `qrcode` | `^1.5.4` | QR code generation for short links |
| `sonner` | `^2.0.7` | Toast notifications |
| `class-variance-authority` | `^0.7.1` | Component variant styling |
| `clsx` | `^2.1.1` | Conditional class name composition |
| `tailwind-merge` | `^3.5.0` | Conflict-free Tailwind class merging |
| `react-hook-form` / `@hookform/resolvers` | `^7.71.2` / `^5.2.2` | Form state management and schema resolvers |
| `date-fns` | `^4.1.0` | Date formatting and manipulation utilities |
| `recharts` | `^2.15.4` | Charting library available in UI toolkit |
| `cmdk` | `^1.1.1` | Command palette primitive |
| `vaul` | `^1.1.2` | Drawer primitive |
| `embla-carousel-react` | `^8.6.0` | Carousel component primitive |
| `input-otp` | `^1.4.2` | One-time password input primitive |
| `react-day-picker` | `^9.14.0` | Calendar date picker primitive |
| `react-resizable-panels` | `^4.6.5` | Resizable split-pane layout primitive |
| `vite-tsconfig-paths` | `^6.0.2` | TypeScript path alias resolution (`@/*` → `./src/*`) |
| `@radix-ui/react-*` (27 packages) | `^1.x` / `^2.x` | `accordion`, `alert-dialog`, `aspect-ratio`, `avatar`, `checkbox`, `collapsible`, `context-menu`, `dialog`, `dropdown-menu`, `hover-card`, `label`, `menubar`, `navigation-menu`, `popover`, `progress`, `radio-group`, `scroll-area`, `select`, `separator`, `slider`, `slot`, `switch`, `tabs`, `toggle`, `toggle-group`, `tooltip` |

#### Development & Build Dependencies (`devDependencies` in `package.json`)

| Package | Version | Purpose |
| :--- | :--- | :--- |
| `vite` | `8.1.5` (`rolldown` override `1.2.1`) | Frontend & SSR build tool and dev server |
| `@vitejs/plugin-react` | `^5.2.0` | React Fast Refresh and JSX compilation |
| `@lovable.dev/vite-tanstack-config` | `2.25.3` | Unified Vite + TanStack Start + Nitro configuration preset |
| `nitro` | `3.0.260603-beta` | Server production bundler |
| `typescript` | `^5.8.3` | TypeScript compiler and type checker |
| `drizzle-orm` / `drizzle-kit` | `^0.45.3` / `^0.31.11` | PostgreSQL ORM and migration toolkit (`drizzle.config.ts`) |
| `postgres` | `^3.4.9` | PostgreSQL driver |
| `eslint` / `@eslint/js` | `^9.32.0` | Static code analysis (Flat Config in `eslint.config.js`) |
| `typescript-eslint` | `^8.56.1` | TypeScript ESLint ruleset |
| `eslint-plugin-react-hooks` | `^5.2.0` | React Hooks lint rules |
| `eslint-plugin-react-refresh` | `^0.4.20` | Fast Refresh component export validation |
| `prettier` / `eslint-plugin-prettier` / `eslint-config-prettier` | `^3.7.3` / `^5.2.6` / `^10.1.1` | Code formatting and ESLint integration |
| `globals` | `^15.15.0` | Browser global variable definitions for ESLint |
| `@types/node`, `@types/react`, `@types/react-dom`, `@types/qrcode` | `^22.16.5`, `^19.2.0`, `^1.5.6` | TypeScript ambient type definitions |

---

### 5. Redirect Detection & Chain Analysis Engine

The core redirect tracing architecture is divided into modular server-side and isomorphic engines in `src/lib/`:

- **`src/lib/trace-engine.server.ts` (Universal Server-Side Trace Engine)**:
  - Executes manual hop-by-hop HTTP requests (`redirect: "manual"`) up to `MAX_HOPS = 20`, with `PER_HOP_TIMEOUT_MS = 15_000` (15 s) and `OVERALL_TIMEOUT_MS = 55_000` (55 s), reading up to `MAX_BODY_BYTES = 2_000_000` (2 MB) of HTML per hop.
  - Classifies every hop into 10 distinct mechanisms (`HopMechanism`): `http-redirect`, `javascript-redirect`, `meta-refresh`, `form-redirect`, `gateway-unwrap`, `browser-navigation`, `final-response`, `blocked`, `unresolved`, and `error`.
  - Follows standard `Location` headers on `301`, `302`, `303`, `307`, `308` (and any `3xx` with `Location`), plus non-standard redirect headers (`Refresh`, `HX-Redirect`, `X-Redirect`, `X-Redirect-To`).
  - **`TraceCookieJar`**: Stateful per-trace in-memory cookie jar that parses `Set-Cookie` headers (`Domain`, `Path`, `Secure`, `HttpOnly`, `SameSite`, expiry) and replays matching `Cookie` headers on subsequent hops so affiliate/auth gates do not fail.
  - **Referer Propagation**: Automatically forwards `Referer` across hops while respecting `Referrer-Policy` (`no-referrer`, `same-origin`, `origin`, `strict-origin`, `strict-origin-when-cross-origin`).
- **`src/lib/trace-detect.ts` (Static HTML, Script De-Obfuscation & Gateway Unwrapper)**:
  - **HTML `<meta http-equiv="refresh">`**: Parses `content="N; url=..."` attributes while stripping `<noscript>`, `<template>`, and HTML comments to prevent false positives.
  - **Deep JavaScript De-Obfuscation**: Decodes Base64 (`atob("...")`), hexadecimal (`\xNN`), Unicode (`\uNNNN`), `decodeURIComponent(...)`, `String.fromCharCode(...)`, ` "str".split("").reverse().join("")`, JS string concatenation (`"https://" + "host" + "/path"`), variable indirection (`const u = "..."; location.href = u`), and `setTimeout` redirects.
  - **Auto-Submit Form Detection**: Detects `<form action="...">` elements paired with `.submit()` or `onload` auto-submission scripts.
  - **Next.js / Nuxt / SPA & Interstitial Detection**: Extracts redirect targets from `__NEXT_DATA__`, canonical refresh tags, and thin interstitial anchor pages.
  - **Gateway & Link-Shim Unwrapping (`extractEmbeddedTargets`)**: Unwraps nested URLs from query parameters (`url`, `u`, `target`, `dest`, `redirect`, `redirect_uri`, `continue`, `return_to`, `goto`, `out`, `r`, `ulp`, `adurl`, `fallback_url`), Base64/Hex/double-URL-encoded parameters, Microsoft Outlook SafeLinks, Proofpoint `urldefense.com/v3/__...__`, Google `/url?q=`, Facebook `l.facebook.com/l.php`, YouTube `/redirect`, and Google AMP cache URLs.
- **`src/lib/trace-browser.server.ts` (Sandboxed Headless-Browser Fallback)**:
  - Invoked when a `200 OK` page looks like a dynamic client-side redirector (`looksLikeRedirector`) that static de-obfuscation cannot resolve.
  - Supports **Local Sandboxed Chromium** via `playwright-core` (`chrome-headless-shell` with `--no-sandbox`, timer acceleration overriding `setTimeout`/`setInterval` delays `> 250ms` down to `50ms`, `window.open` interception, and per-request SSRF route filtering) as well as **Remote Browserless** (`BROWSERLESS_TOKEN` / `BROWSERLESS_URL`).

---

### 6. URL Parsing, Resolution & Normalization

Implemented across `src/lib/redirect-analysis.ts` and `src/lib/migration-parser.ts`:

- **URL Normalization (`normalizeUrl`)**: Trims whitespace, defaults schemeless inputs to `https://`, validates via the WHATWG `URL` constructor, and resolves relative hop `Location` values (`new URL(rawTarget, baseUrl)`).
- **Tracking Parameter Recognition (`isTrackingParam`, `stripTrackingParams`, `buildTrackingReport`)**:
  - Tracks 25+ known marketing/affiliate parameters (`utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `utm_id`, `gclid`, `gbraid`, `wbraid`, `fbclid`, `msclkid`, `ttclid`, `twclid`, `li_fat_id`, `mc_cid`, `mc_eid`, `yclid`, `dclid`, `igshid`, `si`, `_ga`, `_gl`, `ref`, `aff_id`, `click_id`) plus any `utm_*` prefix.
  - Computes hop-by-hop parameter diffs (`added`, `removed`, `modified`) and distinguishes between parameters preserved to the final URL (`keptTrackingParams`) and parameters consumed/dropped by intermediate trackers (`strippedTrackingParams`).
- **Bulk Migration Config Parser (`parseMigrationInput` in `src/lib/migration-parser.ts`)**:
  - Automatically detects and extracts testable source URLs from **XML Sitemaps** (`<loc>...</loc>`), **Apache `.htaccess`** (`Redirect`, `RedirectPermanent`, `RedirectMatch`, `RewriteRule`), **Nginx configs** (`location`, `rewrite`, `return 301/302`), CSV, and plain-text lists.

---

### 7. HTTP/HTTPS Request Handling & Networking

- **Native Fetch API with `AbortSignal.timeout`**: Server-side hops use native `fetch(url, { method: "GET", redirect: "manual", headers, signal: AbortSignal.timeout(timeoutMs) })` with realistic browser/bot headers (`User-Agent`, `Accept`, `Accept-Language`, `Cache-Control: no-cache`).
- **6 User-Agent Presets (`USER_AGENT_PRESETS`)**:
  - `desktop-chrome` (Desktop Chrome 131 on macOS)
  - `mobile-iphone` (Mobile Safari 18 on iOS)
  - `mobile-android` (Chrome 131 Mobile on Android 14 / Pixel 8)
  - `googlebot-smartphone` (Googlebot Smartphone)
  - `googlebot-desktop` (Googlebot Desktop)
  - `social-bot` (`facebookexternalhit/1.1` / Link Preview Bot)
- **Streaming Body Cap (`readLimitedBody`)**: Reads response bodies via `response.body.getReader()` + `TextDecoder`, cancelling the stream immediately once `MAX_BODY_BYTES` (2 MB) is reached to prevent memory exhaustion on large files.
- **DNS-over-HTTPS (DoH) Resolution (`src/lib/trace-ssrf.server.ts`)**: Resolves `A` (IPv4) and `AAAA` (IPv6) records via `https://cloudflare-dns.com/dns-query` (`application/dns-json`, configurable via `DOH_ENDPOINT`) with an in-memory TTL cache (`DNS_CACHE_TTL_MS = 60_000`, max 500 entries).

---

### 8. Browser APIs & Web Platform Features

- **Storage APIs**: `window.localStorage` for persisting theme preference (`crosx-theme`), recent trace history (`src/routes/index.tsx`), anonymous short-link owner tokens (`src/routes/links.tsx`), and monitored redirect baselines (`src/lib/redirect-monitor.ts`); `window.sessionStorage` for preview auth storage (`src/integrations/supabase/previewAuthStorage.ts`).
- **Clipboard & File Download APIs**: `navigator.clipboard.writeText` for one-click copying of URLs, cURL commands, server redirect rules, and bookmarklets; `Blob` + `URL.createObjectURL` for downloading `.json`, `.csv`, `.md`, `.txt`, `.har`, `.svg`, `.htaccess`, and Chrome Extension Manifest V3 files.
- **File Reader API**: `File.text()` for importing local `sitemap.xml`, `.htaccess`, `nginx.conf`, `.csv`, and `.txt` files in `src/components/analyzer/UrlInputPanel.tsx`.
- **Media & Viewport APIs**: `window.matchMedia("(prefers-color-scheme: dark)")` for system theme synchronization (`src/lib/theme.tsx`).
- **Performance API**: `performance.now()` for sub-millisecond hop timing and `Server-Timing: total;dur=...` HTTP response headers (`src/server.ts`).

---

### 9. Data Processing & Analysis Logic

| Module | File Path | Core Capabilities |
| :--- | :--- | :--- |
| **SEO Signal & Grade Engine** | `src/lib/redirect-analysis.ts`, `src/lib/redirect-rules-codegen.ts` | Computes SEO Impact Score (`0–100`), Grade (`Pass` / `Warning` / `Critical`), link-equity loss estimation, canonical mismatch detection, `X-Robots-Tag` / `<meta name="robots">` indexability checks, HTTPS transition status (`clean-https`, `upgraded-to-https`, `downgraded-to-http`, `unencrypted-http`), and HSTS presence. |
| **301 Redirect Codegen Engine** | `src/lib/redirect-rules-codegen.ts` | Generates copy-ready 301 consolidation rules for **Nginx**, **Apache (`.htaccess`)**, **Cloudflare Bulk Redirects (`_redirects`)**, **Cloudflare Worker (`worker.js`)**, **WordPress (`functions.php`)**, **Vercel (`vercel.json`)**, and **Netlify (`_redirects`)**, plus batch consolidated rule exports (`generateBatchConsolidatedRules`). |
| **Cloaking & Bot Matrix** | `src/lib/redirect-rules-codegen.ts` (`evaluateCloakingMatrix`) | Compares Desktop Chrome, Mobile iPhone, and Googlebot Smartphone traces in parallel to detect split destinations, status-code discrepancies, or bot-targeted cloaking. |
| **Threat & Phishing Scanner** | `src/lib/threat-scanner.ts` (`scanRedirectThreats`) | Computes a `0–100` Trust Score and Risk Level (`clean`, `low-risk`, `medium-risk`, `high-risk`, `critical-threat`) across all hops. Detects Punycode/IDN homograph attacks (`xn--`), lookalike brand spoofing, high-risk TLDs, raw IP hosts, open-redirect parameter abuse, protocol downgrades, and audits 5 security headers (`Strict-Transport-Security`, `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`). |
| **HAR v1.2 & Flowchart SVG** | `src/lib/redirect-har.ts` (`toHar`, `toFlowchartSvg`) | Serializes redirect chains into standard HTTP Archive v1.2 (`.har`) JSON files compatible with Chrome DevTools and generates standalone vector flowchart diagrams (`.svg`). |
| **Redirect Drift Monitor** | `src/lib/redirect-monitor.ts` | Captures baseline snapshots (`createBaselineFromAnalysis`), evaluates live traces for destination hijacks, hop increases, status degradation, and tracking changes (`evaluateRedirectDrift`), and formats Slack, Discord, and custom JSON webhook alerts (`formatWebhookPayload`). |
| **Smart Rules & A/B Rotator** | `src/lib/link-rules.ts` (`evaluateRules`, `parseUserAgent`) | Evaluates priority-ordered conditional routing rules for short links based on `country`, `device`, `browser`, `os`, `day_of_week`, `hour_utc`, `query_param`, and deterministic `ab_split` traffic buckets (`0–99`). |

---

### 10. State Management & Data Flow

- **TanStack React Query (`@tanstack/react-query` `^5.101.1`)**: Configured in `src/router.tsx` (`staleTime: 30_000`, `gcTime: 300_000`). Manages asynchronous queries (`useQuery`) and mutations (`useMutation`) for short-link CRUD, analytics, and trace execution.
- **Isomorphic Service Layer (`src/lib/redirect-service.ts`)**: Routes trace requests either to an optional external endpoint (`VITE_REDIRECT_API_URL`) or to the built-in TanStack Start server functions (`analyzeRedirectChain`, `analyzeRedirectChains`, `compareRedirectAgents`), then asynchronously persists shareable snapshots via `saveAnalyses` (`Promise.race` with a 1.5 s non-blocking timeout).
- **React Context (`src/lib/theme.tsx`)**: Provides `ThemeProvider` and `useTheme()` (`light` / `dark` / `system`) with an inline `<script>` (`themeInitScript`) in `<head>` to prevent Flash of Incorrect Theme (FOIT) without hydration mismatches.

---

### 11. API Integrations, Request Lifecycle & External Services

| Service / Integration | Configuration / Endpoint | Role in Project |
| :--- | :--- | :--- |
| **Supabase (PostgreSQL + PostgREST RPC)** | `@supabase/supabase-js` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`) | Persists shared redirect analysis reports (`redirect_analyses` table in `src/lib/analysis-store.ts`) and short links / click analytics (`short_links` table + `create_short_link`, `list_short_links`, `set_short_link_enabled`, `delete_short_link`, `resolve_short_link` RPCs). Includes an automatic circuit-breaker fallback to local `.data/shortlinks-store.json` when Supabase is unconfigured or unreachable. |
| **Cloudflare DNS-over-HTTPS (DoH)** | `https://cloudflare-dns.com/dns-query` (or `DOH_ENDPOINT`) | Resolves `A` and `AAAA` records over HTTPS JSON prior to every outbound request to prevent DNS rebinding and SSRF attacks. |
| **Browserless (Optional)** | `BROWSERLESS_TOKEN`, `BROWSERLESS_URL` | Optional remote headless Chromium fallback when local `playwright-core` Chromium is unavailable. |
| **Slack / Discord / Custom Webhooks** | `dispatchMonitorWebhook` (`src/lib/enterprise-tools.functions.ts`) | Server-side HTTPS `POST` dispatcher for Redirect Drift Monitor alerts (SSRF-validated before dispatch). |
| **Google Fonts CDN** | `https://fonts.googleapis.com` (`Geist`, `Geist Mono`, `Plus Jakarta Sans`, `JetBrains Mono`) | Loaded via preconnected stylesheet links in `src/routes/__root.tsx`. |

#### Chain Analysis Request Lifecycle & Gemini API Clarification

- **Verified Gemini API Status (Zero-LLM Deterministic Engine)**:
  - Although `GEMINI_API_KEY` is defined in `.env.example` as a standard AI Studio runtime environment variable, the Redirect Chain Analyser **does not install `@google/genai` and makes zero requests to the Gemini API or any external LLM**.
  - Every redirect hop, script de-obfuscation pass, SEO grade (`gradeSeoAnalysis`), and threat-intelligence score (`scanRedirectThreats`) is computed deterministically in Node.js and TypeScript to guarantee authentic, non-hallucinated network telemetry.
- **How Chain Analysis Requests Are Structured & Handled**:
  1. **Client Service Dispatch (`src/lib/redirect-service.ts`)**:
     - Normalizes input URLs via `normalizeUrl` and routes requests either to an optional external endpoint (`VITE_REDIRECT_API_URL`) or to built-in TanStack Start server functions (`analyzeRedirectChain`, `analyzeRedirectChains`, `compareRedirectAgents`).
  2. **Schema Validation (`zod` in `src/lib/redirect.functions.ts` & `src/routes/api/public/trace.ts`)**:
     - Single-URL RPC payload: `{ url: z.string().trim().min(1).max(2048), userAgent?: UserAgentPreset }`.
     - Batch RPC payload: `{ urls: z.array(z.string().trim().min(1).max(2048)).min(1).max(20), userAgent?: UserAgentPreset }`.
     - Public REST endpoint (`/api/public/trace`): Accepts `GET ?url=...&userAgent=...` or `POST { url?: string, urls?: string[], userAgent?: UserAgentPreset }` (up to 5 URLs per public API call), protected by WAF inspection (`inspectIncomingRequest`), optional constant-time Bearer key verification (`REDIRECT_TRACER_API_KEY`), per-fingerprint rate limiting (`checkRateLimit(fp, "trace")`), and per-IP concurrency semaphores (`acquireConcurrencySlot(ip, "trace")`).
  3. **Singleflight Coalescing & Worker Pool Execution**:
     - Each validated URL is scheduled across a bounded 5-worker concurrent pool and wrapped in `coalesceInFlight("trace:<userAgent>:<url>", () => traceUrl(url, userAgent))` so simultaneous identical requests share a single outbound trace.
  4. **Hop-by-Hop Execution & Structured Response (`RedirectAnalysis`)**:
     - `traceUrl` (`src/lib/trace-engine.server.ts`) validates each hop via `assertSafeUrl` (Cloudflare DoH + IPv4/IPv6 CIDR classification), executes manual HTTP fetches (`redirect: "manual"`), extracts static client redirects (`detectClientRedirect`, `extractEmbeddedTargets`) or invokes the sandboxed Chromium fallback (`traceWithBrowser`), and assembles the strongly typed `RedirectAnalysis` payload (`startUrl`, `finalUrl`, `finalDestinationConfirmed`, `hops[]`, `issues[]`, `tracking`, `seo`, `totalResponseTimeMs`).

---

### 12. Security Mechanisms & Validation

- **Strict SSRF Protection (`src/lib/trace-ssrf.server.ts`)**:
  - Validates every user-supplied URL, intermediate redirect hop, remote sitemap URL, short-link destination, and webhook URL via `assertSafeUrl`.
  - Restricts protocols to `http:` and `https:` and ports to `80`, `443`, `8000`, `8080`, `8443`.
  - Rejects embedded URL credentials (`username:password@host`), internal hostnames (`localhost`, `.local`, `.internal`, `.onion`, `metadata.google.internal`, `169.254.169.254`, `100.100.100.200`), and non-standard octal IPv4 encodings.
  - Classifies both literal IPs and DNS-resolved `A`/`AAAA` addresses (`classifyIp`) against 15 IPv4 CIDR block ranges (`0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.168.0.0/16`, multicast, reserved) and IPv6 ranges (`::1`, `fc00::/7` ULA, `fe80::/10` link-local, `::ffff:0:0/96` IPv4-mapped, `64:ff9b::/96` NAT64, `2002::/16` 6to4, `2001:db8::/32`).
- **Web Application Firewall (`inspectIncomingRequest` in `src/lib/security.server.ts`)**:
  - Blocks disallowed HTTP methods, oversized URLs (`> 4096` chars), header bombs (`> 16 KB`), oversized POST payloads (`> 64 KB`), known scanner User-Agents (`sqlmap`, `nikto`, `nuclei`, `masscan`, `gobuster`, `wpscan`, `acunetix`), sensitive dotfile/admin paths (`.env`, `.git`, `wp-admin`, `phpmyadmin`, `etc/passwd`), path traversal (`../`, `%2e%2e`, null bytes), and SQLi/XSS query payloads.
- **Multi-Tier Rate Limiter & Concurrency Semaphore (`src/lib/security.server.ts`)**:
  - Enforces sliding-window (`60s`), micro-burst (`5s`), and exponential repeat-offender lockout limits across 4 tiers (`global`, `trace`, `shortlink-write`, `shortlink-redirect`).
  - Caps simultaneous in-flight requests per IP and globally (`acquireConcurrencySlot`) with automatic 60 s safety lease expiration.
- **Singleflight Request Coalescing (`coalesceInFlight`)**: Deduplicates identical concurrent trace requests (`trace:<userAgent>:<url>`) into a single outbound execution.
- **Constant-Time Secret Comparison (`constantTimeEquals`)**: Protects Bearer API key validation on `/api/public/trace` against timing side-channel attacks.
- **Hardened HTTP Security Headers (`applySecurityHeaders`)**: Applies `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-DNS-Prefetch-Control: off`, `X-Download-Options: noopen`, `X-Permitted-Cross-Domain-Policies: none`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, and `Cross-Origin-Opener-Policy: same-origin-allow-popups`.

---

### 13. Error Handling & Performance Optimization

- **SSR Catastrophic Error Normalization (`src/server.ts`, `src/lib/error-capture.ts`, `src/lib/error-page.ts`)**: Captures unhandled exceptions and normalizes `h3` swallowed JSON 500 responses into a clean, user-friendly HTML fallback page.
- **Upstream Database Circuit Breaker (`src/lib/shortlinks.server.ts`)**: Detects Cloudflare `1016` / DNS failures or timeouts (`3.5s`) when calling Supabase, trips a `60s` circuit cooldown (`UPSTREAM_CIRCUIT_COOLDOWN_MS`), and seamlessly falls back to `.data/shortlinks-store.json` so short-link creation and resolution never fail.
- **Bounded Worker Pool**: Batch URL tracing in `src/lib/redirect.functions.ts` processes up to 20 URLs using a bounded 5-worker concurrent queue combined with Singleflight deduplication.
- **Dependency Pre-Bundling**: `vite.config.ts` pre-optimizes 28 core React, TanStack, Radix UI, and utility packages in `optimizeDeps.include` and deduplicates React/TanStack singletons in `resolve.dedupe`.

---

### 14. Build Tools, Development Tools & Package Managers

| Tool | Command / Config | Description |
| :--- | :--- | :--- |
| **npm** (`package-lock.json`) | `npm install` | Primary package manager and lockfile. |
| **Vite v8** (`vite.config.ts`) | `npm run dev` (`vite dev`), `npm run build` (`vite build`), `npm run preview` (`vite preview`) | Development server (port `3000`, `0.0.0.0`) and production client/SSR bundler with `rolldown` (`1.2.1`) override. |
| **ESLint v9** (`eslint.config.js`) | `npm run lint` (`eslint .`) | Lints `.ts` and `.tsx` files and enforces `no-restricted-imports` against Next.js `server-only` in favor of `*.server.ts`. |
| **Prettier v3** (`.prettierrc`) | `npm run format` (`prettier --write .`) | Code formatter integrated with ESLint via `eslint-plugin-prettier`. |
| **Drizzle Kit** (`drizzle.config.ts`) | `drizzle-kit` (`^0.31.11`) | Configured for PostgreSQL schema/migration management (`./drizzle/schema.ts`). |

---

### 15. Testing Frameworks & Testing Utilities

- **Node.js Built-in Test Runner (`node:test` + `node:assert/strict`)**: Executed via `npx tsx --test`:
  - **`src/lib/security.test.ts`**: Verifies WAF request inspection, SQLi/XSS/path-traversal blocking, burst rate limiting, repeat-offender lockouts, per-IP/global concurrency semaphores, Singleflight coalescing, security headers, and constant-time comparisons.
  - **`src/lib/seo.test.ts`**: Verifies canonical URLs (`https://rca.crosx.in`), OpenGraph/Twitter meta builders, Schema.org `@graph` JSON-LD generators, SSRF IPv4/IPv6/NAT64/6to4/octal classification, smart link rule evaluation, 301 server rule codegen (Nginx, Apache, Cloudflare, Cloudflare Worker, WordPress, Vercel, Netlify), bot cloaking matrix, Base64/Hex/CharCode/reversed-string/form de-obfuscation, `TraceCookieJar`, Threat Scanner, HAR v1.2/SVG exporters, Sitemap/Apache/Nginx migration parser, Redirect Drift Monitor, and A/B Split Rotator.
  - **`src/lib/shortlinks.test.ts`**: Verifies Cloudflare 1016/upstream DNS error detection and the complete short-link lifecycle (create, list, resolve, click increment, analytics aggregation, and delete).

---

### 16. Deployment, SEO & Environment Configuration

- **Technical SEO & Generative Engine Optimization (`src/lib/seo.ts`, `public/`)**:
  - Canonical domain `https://rca.crosx.in` (`SITE_URL`), OpenGraph & Twitter Cards, `hreflang` alternates (`en`, `x-default`), and Schema.org `@graph` JSON-LD (`WebApplication`, `Organization`, `WebSite` with `SearchAction`, `BreadcrumbList`, `HowTo`, and `FAQPage`).
  - Static crawl and AI discovery assets in `public/`: `robots.txt`, `sitemap.xml`, `llms.txt`, and `manifest.webmanifest` (PWA Web App Manifest).
- **Environment Variables**:

| Variable | Scope | Description |
| :--- | :--- | :--- |
| `VITE_SITE_URL` | Client & Server | Optional canonical origin override (defaults to `https://rca.crosx.in`). |
| `VITE_REDIRECT_API_URL` | Client | Optional external trace API endpoint override (defaults to built-in TanStack server functions). |
| `VITE_SUPABASE_URL` / `SUPABASE_URL` | Client & Server | Supabase project URL for shared reports and short links. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_PUBLISHABLE_KEY` | Client & Server | Supabase publishable/anon API key. |
| `VITE_SUPABASE_PROJECT_ID` / `SUPABASE_PROJECT_ID` | Client & Server | Supabase project identifier. |
| `REDIRECT_TRACER_API_KEY` | Server | Optional Bearer token protecting `/api/public/trace`. |
| `DOH_ENDPOINT` | Server | Optional DNS-over-HTTPS endpoint override (defaults to `https://cloudflare-dns.com/dns-query`). |
| `BROWSERLESS_TOKEN` / `BROWSERLESS_URL` | Server | Optional remote Browserless token and endpoint for headless-browser fallback. |
| `LOVABLE_DB_MIGRATION_URL` | Build / CLI | PostgreSQL connection string used by `drizzle.config.ts`. |
| `APP_URL` / `GEMINI_API_KEY` | Runtime (`.env.example`) | Standard AI Studio runtime environment variables. |

---

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/af61ac39-014c-4107-9369-28f94f73eb66).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
