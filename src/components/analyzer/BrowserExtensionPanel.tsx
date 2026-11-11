import { Bookmark, Download, Puzzle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { downloadFile } from "@/lib/redirect-export";
import { SITE_URL } from "@/lib/seo";
import { CopyButton } from "./CopyButton";

const BOOKMARKLET_HREF = `javascript:void(window.open('${SITE_URL}/?url='+encodeURIComponent(window.location.href),'_blank','noopener,noreferrer'));`;

function buildExtensionBundleJson(): string {
  const manifest = {
    manifest_version: 3,
    name: "Redirect Chain Analyzer — CROSX",
    version: "2.0.0",
    description:
      "Trace HTTP 301/302/307/308, Meta Refresh, and obfuscated JavaScript redirects in one click with CROSX.",
    permissions: ["contextMenus", "activeTab"],
    background: {
      service_worker: "background.js",
    },
    action: {
      default_title: "Trace Current Tab Redirect Chain",
    },
  };

  const backgroundJs = `chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "crosx-trace-link",
    title: "Trace Link with CROSX Redirect Analyzer",
    contexts: ["link", "page"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const target = info.linkUrl || info.pageUrl || (tab && tab.url);
  if (target) {
    chrome.tabs.create({
      url: "${SITE_URL}/?url=" + encodeURIComponent(target)
    });
  }
});

chrome.action.onClicked.addListener((tab) => {
  if (tab && tab.url) {
    chrome.tabs.create({
      url: "${SITE_URL}/?url=" + encodeURIComponent(tab.url)
    });
  }
});`;

  return JSON.stringify(
    {
      instructions:
        "Save 'manifest.json' and 'background.js' into a folder, then open chrome://extensions -> Enable Developer Mode -> Load unpacked.",
      "manifest.json": manifest,
      "background.js": backgroundJs,
    },
    null,
    2,
  );
}

export function BrowserExtensionPanel() {
  function handleDownloadExtension() {
    downloadFile("crosx-chrome-extension-mv3.json", buildExtensionBundleJson(), "application/json");
    toast.success("Chrome/Edge Manifest V3 extension bundle downloaded");
  }

  return (
    <section
      aria-labelledby="browser-companion-heading"
      className="panel animate-rise space-y-3 p-4 sm:p-6"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.09em] text-brand">
            <Puzzle className="size-3.5" />
            Browser Bookmarklet &amp; Chrome Extension Companion
          </span>
          <h3
            id="browser-companion-heading"
            className="mt-0.5 text-base font-semibold tracking-tight text-foreground"
          >
            Trace any webpage or right-clicked link in one click
          </h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            ref={(el) => {
              if (el) el.setAttribute("href", BOOKMARKLET_HREF);
            }}
            onClick={(e) => {
              e.preventDefault();
              toast.message("Drag this button to your Bookmarks Bar", {
                description: "Or copy the bookmarklet code to trace any open tab in 1 click.",
              });
            }}
            className="inline-flex h-9 cursor-grab items-center gap-1.5 rounded-lg border border-brand/35 bg-brand/10 px-3 text-xs font-semibold text-foreground transition-colors hover:bg-brand/15"
          >
            <Bookmark className="size-3.5 text-brand" />
            Trace with CROSX
          </a>
          <CopyButton value={BOOKMARKLET_HREF} label="Copy bookmarklet script" />
          <Button type="button" variant="subtle" size="sm" onClick={handleDownloadExtension}>
            <Download className="size-3.5 text-brand" />
            Download Chrome Extension (MV3)
          </Button>
        </div>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Drag <strong>Trace with CROSX</strong> to your browser&apos;s bookmarks bar to audit the
        active tab at any time, or download the Manifest V3 Chrome/Edge extension bundle for
        right-click <code className="font-mono text-[11px]">Trace Link with CROSX</code>{" "}
        context-menu inspection.
      </p>
    </section>
  );
}
