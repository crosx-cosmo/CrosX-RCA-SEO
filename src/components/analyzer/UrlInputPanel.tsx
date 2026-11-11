import { useServerFn } from "@tanstack/react-start";
import {
  Bot,
  FileCode2,
  Globe,
  Link2,
  Loader2,
  Monitor,
  Play,
  Rows3,
  Share2,
  Smartphone,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { fetchRemoteSitemap } from "@/lib/enterprise-tools.functions";
import { parseMigrationInput, type ExtractedMigrationRule } from "@/lib/migration-parser";
import { USER_AGENT_PRESETS } from "@/lib/redirect-analysis";
import type { UserAgentPreset } from "@/lib/redirect-types";

const UA_ICON: Record<UserAgentPreset, typeof Monitor> = {
  "desktop-chrome": Monitor,
  "mobile-iphone": Smartphone,
  "mobile-android": Smartphone,
  "googlebot-smartphone": Bot,
  "googlebot-desktop": Bot,
  "social-bot": Share2,
};

interface Props {
  loading: boolean;
  onAnalyze: (urls: string[], userAgent: UserAgentPreset) => void;
  onClear: () => void;
  onDemo: () => void;
  initialUrl?: string;
}

export function UrlInputPanel({ loading, onAnalyze, onClear, onDemo, initialUrl }: Props) {
  const [bulk, setBulk] = useState(false);
  const [single, setSingle] = useState(initialUrl ?? "");
  const [many, setMany] = useState("");
  const [userAgent, setUserAgent] = useState<UserAgentPreset>("desktop-chrome");
  const [showMigrationDrawer, setShowMigrationDrawer] = useState(false);
  const [sitemapUrl, setSitemapUrl] = useState("https://rca.crosx.in/sitemap.xml");
  const [migrationOrigin, setMigrationOrigin] = useState("https://rca.crosx.in");
  const [fetchingSitemap, setFetchingSitemap] = useState(false);
  const [parsedRules, setParsedRules] = useState<ExtractedMigrationRule[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fetchSitemapFn = useServerFn(fetchRemoteSitemap);

  useEffect(() => {
    if (initialUrl) {
      setBulk(false);
      setSingle(initialUrl);
    }
  }, [initialUrl]);

  const urls = useMemo(() => {
    const rawUrls = bulk
      ? many
          .split(/[\n,\s]+/)
          .map((u) => u.trim())
          .filter(Boolean)
      : single.trim()
        ? [single.trim()]
        : [];
    return rawUrls.slice(0, 20);
  }, [bulk, many, single]);

  async function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseMigrationInput(text, migrationOrigin || "https://rca.crosx.in", 20);
      if (!parsed.urls.length) {
        toast.error("No valid URLs or redirect rules found in the uploaded file");
        return;
      }
      setBulk(true);
      setMany(parsed.urls.join("\n"));
      setParsedRules(parsed.rules);
      toast.success(
        `Loaded ${parsed.urls.length} URL${parsed.urls.length === 1 ? "" : "s"} (${parsed.format.toUpperCase()})`,
      );
    } catch {
      toast.error("Could not read file");
    }
  }

  async function handleFetchSitemap() {
    if (!sitemapUrl.trim()) return;
    setFetchingSitemap(true);
    try {
      const parsed = await fetchSitemapFn({ data: { sitemapUrl: sitemapUrl.trim() } });
      if (!parsed.urls.length) {
        toast.error("No <loc> URLs found in that sitemap");
        return;
      }
      setBulk(true);
      setMany(parsed.urls.join("\n"));
      setParsedRules(parsed.rules);
      toast.success(`Extracted ${parsed.urls.length} URL(s) from sitemap.xml`);
    } catch (err) {
      toast.error((err as Error).message || "Failed to fetch sitemap.xml");
    } finally {
      setFetchingSitemap(false);
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    onAnalyze(urls, userAgent);
  }

  function clear() {
    setSingle("");
    setMany("");
    setParsedRules([]);
    onClear();
  }

  return (
    <form
      onSubmit={submit}
      aria-busy={loading}
      className="panel animate-reveal relative overflow-hidden p-4 sm:p-6"
    >
      <span
        className={
          loading
            ? "animate-shimmer pointer-events-none absolute inset-x-0 top-0 h-1 bg-brand/35"
            : "pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand/60 to-transparent"
        }
      />

      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
            <Link2 className="size-4 shrink-0 text-brand" />
            <span className="truncate">{bulk ? "Bulk analysis" : "Analyze a URL"}</span>
          </div>
          <div className="flex items-center gap-2 sm:hidden">
            <Rows3 className="size-3.5 text-muted-foreground" />
            <Label
              htmlFor="bulk-mode-mobile"
              className="text-[11px] font-medium text-muted-foreground"
            >
              Bulk
            </Label>
            <Switch
              id="bulk-mode-mobile"
              checked={bulk}
              onCheckedChange={setBulk}
              disabled={loading}
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1 sm:flex-initial">
            <Label htmlFor="ua-preset" className="sr-only">
              User-Agent profile
            </Label>
            <Select
              value={userAgent}
              onValueChange={(val) => setUserAgent(val as UserAgentPreset)}
              disabled={loading}
            >
              <SelectTrigger
                id="ua-preset"
                aria-label="User-Agent profile"
                className="h-9 w-full gap-2 border-hairline bg-surface-muted px-3 font-mono text-[11.5px] font-medium text-foreground sm:h-8 sm:w-[235px]"
              >
                <SelectValue placeholder="Select User-Agent">
                  {(() => {
                    const ActiveIcon = UA_ICON[userAgent] ?? Monitor;
                    return (
                      <span className="inline-flex min-w-0 items-center gap-2">
                        <ActiveIcon className="size-3.5 shrink-0 text-brand" />
                        <span className="truncate">
                          {USER_AGENT_PRESETS[userAgent]?.label ?? "Desktop Chrome"}
                        </span>
                      </span>
                    );
                  })()}
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="end" className="min-w-[265px]">
                <SelectGroup>
                  <SelectLabel>Simulated User-Agent Profile</SelectLabel>
                  {(
                    Object.entries(USER_AGENT_PRESETS) as Array<
                      [UserAgentPreset, (typeof USER_AGENT_PRESETS)[UserAgentPreset]]
                    >
                  ).map(([key, preset]) => {
                    const Icon = UA_ICON[key] ?? Monitor;
                    return (
                      <SelectItem key={key} value={key} className="font-mono text-[11.5px]">
                        <span className="inline-flex items-center gap-2">
                          <Icon className="size-3.5 shrink-0 text-brand" />
                          <span className="truncate">{preset.label}</span>
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className="hidden items-center gap-2 sm:flex">
            <Rows3 className="size-3.5 text-muted-foreground" />
            <Label htmlFor="bulk-mode" className="text-[11px] font-medium text-muted-foreground">
              Bulk
            </Label>
            <Switch id="bulk-mode" checked={bulk} onCheckedChange={setBulk} disabled={loading} />
          </div>
        </div>
      </div>

      <div className="relative mt-4 overflow-hidden rounded-xl">
        {bulk ? (
          <Textarea
            value={many}
            onChange={(e) => setMany(e.target.value)}
            disabled={loading}
            aria-label="URLs to trace in bulk (one per line)"
            placeholder={"https://example.com/go?click_id=123\nhttps://another.com/offer"}
            rows={5}
            className="resize-y rounded-xl border-hairline bg-surface-muted font-mono text-sm transition-shadow focus-visible:shadow-soft"
          />
        ) : (
          <Input
            value={single}
            onChange={(e) => setSingle(e.target.value)}
            disabled={loading}
            aria-label="URL to trace"
            placeholder="https://example.com/go?click_id=123&aff_id=99"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            className="h-12 rounded-xl border-hairline bg-surface-muted font-mono text-sm transition-shadow focus-visible:shadow-soft"
          />
        )}
        {loading ? (
          <span
            aria-hidden="true"
            className="animate-shimmer pointer-events-none absolute inset-0"
          />
        ) : null}
      </div>

      {showMigrationDrawer ? (
        <div className="mt-3 space-y-2.5 rounded-xl border border-hairline bg-surface-muted/60 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Sitemap XML, Apache .htaccess &amp; Nginx Migration Auditor
            </p>
            <button
              type="button"
              onClick={() => setShowMigrationDrawer(false)}
              className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
            >
              Hide
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <Input
                value={sitemapUrl}
                onChange={(e) => setSitemapUrl(e.target.value)}
                placeholder="https://example.com/sitemap.xml"
                inputMode="url"
                spellCheck={false}
                className="h-9 border-hairline bg-background font-mono text-xs"
              />
            </div>
            <Button
              type="button"
              variant="subtle"
              size="sm"
              disabled={fetchingSitemap || !sitemapUrl.trim()}
              onClick={() => void handleFetchSitemap()}
              className="h-9"
            >
              {fetchingSitemap ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Globe className="size-3.5 text-brand" />
              )}
              Fetch Sitemap XML
            </Button>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <span className="text-[11px] text-muted-foreground">
              Base origin for relative <code className="font-mono">.htaccess</code> /{" "}
              <code className="font-mono">nginx.conf</code> rules:
            </span>
            <Input
              value={migrationOrigin}
              onChange={(e) => setMigrationOrigin(e.target.value)}
              placeholder="https://example.com"
              className="h-8 flex-1 border-hairline bg-background font-mono text-xs"
            />
          </div>
          {parsedRules.length > 0 ? (
            <p className="font-mono text-[11px] text-brand">
              Parsed {parsedRules.length} rule(s) ({parsedRules[0]!.format}) — click Analyze below
              to batch-audit all {parsedRules.length} URL(s).
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Button
          type="submit"
          variant="hero"
          size="lg"
          disabled={loading || !urls.length}
          className="relative overflow-hidden"
        >
          {loading ? (
            <span
              aria-hidden="true"
              className="animate-shimmer pointer-events-none absolute inset-0"
            />
          ) : null}
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
          {loading ? "Analyzing SEO & hops…" : "Analyze"}
        </Button>
        <Button type="button" variant="outline" size="lg" onClick={clear} disabled={loading}>
          <X className="size-4" />
          Clear
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.txt,.xml,.htaccess,.conf,text/csv,text/plain,application/xml,text/xml"
          className="hidden"
          onChange={handleFileUpload}
        />
        <Button
          type="button"
          variant="outline"
          size="lg"
          disabled={loading}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="size-4" />
          Upload CSV / Config
        </Button>
        <Button
          type="button"
          variant={showMigrationDrawer ? "subtle" : "outline"}
          size="lg"
          disabled={loading}
          onClick={() => setShowMigrationDrawer((v) => !v)}
        >
          <FileCode2 className="size-4 text-brand" />
          Sitemap &amp; Config Audit
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="lg"
          onClick={onDemo}
          disabled={loading}
          className="text-muted-foreground hover:text-foreground sm:ml-auto"
        >
          <Sparkles className="size-4 text-brand" />
          Load demo data
        </Button>
      </div>

      {bulk && urls.length > 0 ? (
        <p className="animate-fade mt-3 font-mono text-[11px] text-muted-foreground">
          {urls.length} URL{urls.length === 1 ? "" : "s"} queued · max 20 per run
        </p>
      ) : null}
    </form>
  );
}
