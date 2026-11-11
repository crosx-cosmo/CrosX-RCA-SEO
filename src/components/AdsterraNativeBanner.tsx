import { useEffect, useRef } from "react";

const ADSTERRA_CONTAINER_ID =
  (import.meta.env?.["VITE_ADSTERRA_CONTAINER_ID"] as string | undefined)?.trim() ||
  "container-5bbaef84e44d3e46b1a765f73f920228";
const ADSTERRA_SCRIPT_URL =
  (import.meta.env?.["VITE_ADSTERRA_SCRIPT_URL"] as string | undefined)?.trim() ||
  "https://bauval.org/21/5bbaef84e44d3e46b1a765f73f920228";

let sharedContainer: HTMLDivElement | null = null;
let sharedScript: HTMLScriptElement | null = null;

function getOrCreateSharedContainer(): HTMLDivElement {
  if (!sharedContainer) {
    const existing = document.getElementById(ADSTERRA_CONTAINER_ID) as HTMLDivElement | null;
    if (existing) {
      sharedContainer = existing;
    } else {
      sharedContainer = document.createElement("div");
      sharedContainer.id = ADSTERRA_CONTAINER_ID;
    }
  }
  return sharedContainer;
}

function injectAdsterraScript(targetHost: HTMLElement, forceReload: boolean) {
  if (sharedScript && !forceReload && document.contains(sharedScript)) {
    return;
  }
  if (sharedScript) {
    sharedScript.remove();
    sharedScript = null;
  }

  const script = document.createElement("script");
  script.async = true;
  script.setAttribute("data-cfasync", "false");
  script.referrerPolicy = "no-referrer-when-downgrade";
  script.src = ADSTERRA_SCRIPT_URL;
  sharedScript = script;
  targetHost.appendChild(script);
}

export function AdsterraNativeBanner() {
  const hostRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof document === "undefined") return;

    const container = getOrCreateSharedContainer();
    const hasRenderedAd = container.childElementCount > 0 || container.innerHTML.trim().length > 0;

    // Move the persistent Adsterra container into the active page's banner slot
    // so client-side navigation (e.g. "/" -> "/links") keeps rendered ads intact.
    if (container.parentElement !== host) {
      host.appendChild(container);
    }

    // If the container has not populated yet, (re)inject the Adsterra script.
    if (!hasRenderedAd) {
      injectAdsterraScript(host, true);
    }
  }, []);

  return <aside ref={hostRef} aria-label="Advertisement" className="min-h-[1px] w-full min-w-0" />;
}
