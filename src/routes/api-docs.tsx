import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Braces, ShieldCheck, Zap } from "lucide-react";
import { useState } from "react";

import { BrowserExtensionPanel } from "@/components/analyzer/BrowserExtensionPanel";
import { CopyButton } from "@/components/analyzer/CopyButton";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CROSX_LOGO_URL } from "@/lib/brand";
import {
  API_DOCS_KEYWORDS,
  buildApiDocsStructuredData,
  buildCanonicalLinks,
  buildPageMeta,
} from "@/lib/seo";

const TITLE = "Chain Tracer API — Add Redirect Tracing to Your Own Website";
const DESCRIPTION =
  "Free JSON API to trace redirect chains from your own site or backend: HTTP redirects, meta refresh, JavaScript navigation, tracking parameters and the confirmed final destination.";

export const Route = createFileRoute("/api-docs")({
  head: () => ({
    meta: buildPageMeta({
      title: TITLE,
      description: DESCRIPTION,
      path: "/api-docs",
      keywords: API_DOCS_KEYWORDS,
    }),
    links: buildCanonicalLinks("/api-docs"),
    scripts: [
      {
        type: "application/ld+json",
        children: buildApiDocsStructuredData(DESCRIPTION),
      },
    ],
  }),
  component: ApiDocsPage,
});

const ENDPOINT =
  (import.meta.env?.["VITE_PUBLIC_TRACE_API_URL"] as string | undefined)?.trim() ||
  "https://rca.api.crosx.in/v1/trace";
const ENDPOINT_ORIGIN = (() => {
  try {
    return `${new URL(ENDPOINT).origin}/`;
  } catch {
    return "https://rca.api.crosx.in/";
  }
})();

const SNIPPETS: { id: string; label: string; code: string }[] = [
  {
    id: "curl",
    label: "cURL",
    code: `curl -X POST "${ENDPOINT}" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -d '{"url":"https://example.com"}'`,
  },
  {
    id: "js",
    label: "JavaScript (Node.js backend)",
    code: `const res = await fetch("${ENDPOINT}", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": \`Bearer \${process.env.REDIRECT_TRACER_API_KEY}\`,
  },
  body: JSON.stringify({ url: "https://example.com" }),
});
const data = await res.json();
console.log(data);`,
  },
  {
    id: "get",
    label: "Health Check",
    code: `curl "${ENDPOINT_ORIGIN}"`,
  },
  {
    id: "php",
    label: "PHP",
    code: `$ch = curl_init("${ENDPOINT}");
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER => [
    "Content-Type: application/json",
    "Authorization: Bearer YOUR_API_KEY",
  ],
  CURLOPT_POSTFIELDS => json_encode(["url" => "https://example.com"]),
]);
$data = json_decode(curl_exec($ch), true);
curl_close($ch);
print_r($data);`,
  },
];

const RESPONSE_SAMPLE = `{
  "success": true,
  "result": {
    "startUrl": "https://example.com",
    "finalUrl": "https://example.com",
    "finalDestinationConfirmed": true,
    "hops": [],
    "issues": [],
    "tracking": {
      "diffs": []
    },
    "error": null
  }
}`;

function ApiDocsPage() {
  const [testUrl, setTestUrl] = useState("https://bit.ly/example");
  const [output, setOutput] = useState<string>("");
  const [loading, setLoading] = useState(false);

  async function runTest() {
    setLoading(true);
    setOutput("");
    try {
      const res = await fetch("/api/public/trace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: testUrl }),
      });
      setOutput(JSON.stringify(await res.json(), null, 2));
    } catch (e) {
      setOutput(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-hero min-h-screen">
      <header className="app-safe-top sticky top-0 z-30 border-b border-hairline bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3 sm:gap-4 sm:px-6">
          <Link to="/" aria-label="CROSX home" className="flex shrink-0 items-center">
            <img
              src={CROSX_LOGO_URL}
              alt="CROSX Advertising & Marketing Agency"
              width={160}
              height={28}
              decoding="async"
              loading="eager"
              fetchPriority="high"
              className="h-6 w-auto max-w-[130px] object-contain object-left sm:h-7 sm:max-w-[160px]"
            />
          </Link>
          <span aria-hidden="true" className="h-6 w-px shrink-0 bg-hairline" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[14.5px] font-semibold leading-tight tracking-tight text-foreground sm:text-[15.5px]">
              Chain Tracer API
            </h1>
            <p className="hidden truncate text-[11px] leading-tight text-muted-foreground sm:block">
              Trace redirect chains from your own website or backend
            </p>
          </div>
          <nav aria-label="Secondary navigation" className="flex shrink-0 items-center gap-2">
            <Button asChild variant="subtle" size="sm">
              <Link to="/">
                <ArrowLeft className="size-3.5" />
                Analyzer
              </Link>
            </Button>
            <ThemeToggle />
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-5 px-4 py-7 sm:px-6 sm:py-10">
        <section className="animate-reveal">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface/80 px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted-foreground shadow-soft">
            <Braces className="size-3 text-brand" />
            Developer API
          </span>
          <h2 className="mt-3 text-[26px] font-semibold leading-[1.12] tracking-tight text-foreground sm:text-4xl">
            Put the trace engine{" "}
            <span className="text-gradient-brand">inside your own website</span>
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-[15px]">
            One JSON endpoint returns the full chain — HTTP 301/302/307/308 hops, meta refresh,
            JavaScript navigation, tracking-parameter changes and the confirmed final destination.
            Send authenticated JSON requests to our API using a Bearer API key, and keep your API
            key on your server.
          </p>
        </section>

        <section className="panel space-y-3 p-4 shadow-elevated sm:p-6">
          <p className="text-[10px] font-semibold uppercase tracking-[0.11em] text-muted-foreground">
            Endpoint
          </p>
          <div className="flex items-center justify-between gap-2 rounded-xl border border-hairline bg-surface/70 px-3 py-2">
            <code className="min-w-0 break-all font-mono text-[12.5px] text-foreground">
              POST {ENDPOINT}
            </code>
            <CopyButton value={ENDPOINT} label="Copy endpoint" />
          </div>
          <ul className="grid gap-2 text-[12.5px] text-muted-foreground sm:grid-cols-3">
            <li className="flex items-start gap-2 rounded-xl border border-hairline bg-surface/60 px-3 py-2.5">
              <Zap className="mt-0.5 size-3.5 shrink-0 text-brand" />
              <span>Up to 5 URLs per request, 30 req/min per IP + burst protection.</span>
            </li>
            <li className="flex items-start gap-2 rounded-xl border border-hairline bg-surface/60 px-3 py-2.5">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" />
              <span>SSRF & WAF hardened, 20-hop limit, 15 s per hop, 55 s overall.</span>
            </li>
            <li className="flex items-start gap-2 rounded-xl border border-hairline bg-surface/60 px-3 py-2.5">
              <Braces className="mt-0.5 size-3.5 shrink-0 text-brand" />
              <span>
                Body: <code className="font-mono">{`{ "url": "…" }`}</code> or{" "}
                <code className="font-mono">{`{ "urls": [] }`}</code>
              </span>
            </li>
          </ul>
        </section>

        <section className="panel space-y-4 p-4 shadow-elevated sm:p-6">
          <h3 className="text-[13.5px] font-semibold tracking-tight text-foreground">
            Code examples
          </h3>
          <div className="grid gap-3 md:grid-cols-2">
            {SNIPPETS.map((s) => (
              <div
                key={s.id}
                className="flex flex-col rounded-xl border border-hairline bg-surface/70"
              >
                <div className="flex items-center justify-between border-b border-hairline px-3 py-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
                    {s.label}
                  </span>
                  <CopyButton value={s.code} label={`Copy ${s.label} example`} />
                </div>
                <pre className="flex-1 overflow-x-auto px-3 py-3 font-mono text-[11.5px] leading-relaxed text-foreground">
                  {s.code}
                </pre>
              </div>
            ))}
          </div>
        </section>

        <section className="panel space-y-3 p-4 shadow-elevated sm:p-6">
          <h3 className="text-[13.5px] font-semibold tracking-tight text-foreground">Try it now</h3>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              value={testUrl}
              onChange={(e) => setTestUrl(e.target.value)}
              placeholder="https://example.com/redirect"
              className="h-10 flex-1 border-hairline bg-surface-muted font-mono text-[12.5px]"
            />
            <Button
              variant="hero"
              className="h-10 shrink-0"
              onClick={runTest}
              disabled={loading || !testUrl.trim()}
            >
              {loading ? "Tracing…" : "Send request"}
            </Button>
          </div>
          {output ? (
            <pre className="max-h-96 overflow-auto rounded-xl border border-hairline bg-surface/70 px-3 py-3 font-mono text-[11.5px] leading-relaxed text-foreground">
              {output}
            </pre>
          ) : null}
        </section>

        <section className="panel space-y-3 p-4 shadow-elevated sm:p-6">
          <h3 className="text-[13.5px] font-semibold tracking-tight text-foreground">
            Response shape
          </h3>
          <pre className="overflow-x-auto rounded-xl border border-hairline bg-surface/70 px-3 py-3 font-mono text-[11.5px] leading-relaxed text-foreground">
            {RESPONSE_SAMPLE}
          </pre>
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            Each hop is labelled with its mechanism:{" "}
            <code className="font-mono">http-redirect</code>,{" "}
            <code className="font-mono">meta-refresh</code>,{" "}
            <code className="font-mono">javascript-redirect</code>,{" "}
            <code className="font-mono">browser-navigation</code> or{" "}
            <code className="font-mono">final-response</code>. When a hop cannot be safely followed,
            the exact reason is returned instead of a fake completion, and{" "}
            <code className="font-mono">finalDestinationConfirmed</code> is{" "}
            <code className="font-mono">false</code>.
          </p>
        </section>

        <BrowserExtensionPanel />

        <footer className="space-y-2 border-t border-hairline pt-4 text-center font-mono text-[11px] leading-relaxed text-muted-foreground">
          <nav
            aria-label="Footer navigation"
            className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px]"
          >
            <Link to="/" className="hover:text-foreground">
              Redirect Chain Analyzer
            </Link>
            <span aria-hidden="true">·</span>
            <Link to="/links" className="hover:text-foreground">
              Short Links &amp; UTM Builder
            </Link>
            <span aria-hidden="true">·</span>
            <Link to="/api-docs" className="hover:text-foreground">
              Chain Tracer JSON API
            </Link>
            <span aria-hidden="true">·</span>
            <a href="/sitemap.xml" className="hover:text-foreground">
              Sitemap
            </a>
            <span aria-hidden="true">·</span>
            <a href="/llms.txt" className="hover:text-foreground">
              LLMs.txt
            </a>
          </nav>
        </footer>
      </main>
    </div>
  );
}
