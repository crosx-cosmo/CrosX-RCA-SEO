import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "rca-theme";

export const THEME_COLORS: Record<Theme, string> = {
  light: "#fbfbfb",
  dark: "#131313",
};

/**
 * Inline script injected in <head> so the correct theme class is applied
 * before first paint (no flash), honouring localStorage then system preference.
 * Also sets the browser/status-bar colour so the installed PWA never flashes
 * the wrong theme on startup.
 */
export const themeInitScript = `(function(){try{var k='${THEME_STORAGE_KEY}';var s=localStorage.getItem(k);var m=window.matchMedia('(prefers-color-scheme: dark)').matches;var t=s==='light'||s==='dark'?s:(m?'dark':'light');var e=document.documentElement;e.classList.toggle('dark',t==='dark');e.style.colorScheme=t;var c=t==='dark'?'${THEME_COLORS.dark}':'${THEME_COLORS.light}';var ms=document.querySelectorAll('meta[name="theme-color"]');for(var i=0;i<ms.length;i++){ms[i].setAttribute('content',c);}}catch(e){}})();`;

interface ThemeContextValue {
  theme: Theme;
  mounted: boolean;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readTheme(): Theme {
  if (typeof document === "undefined") return "light";
  if (document.documentElement.classList.contains("dark")) return "dark";
  return "light";
}

function applyTheme(theme: Theme) {
  const el = document.documentElement;
  el.classList.toggle("dark", theme === "dark");
  el.style.colorScheme = theme;
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  metas.forEach((meta) => meta.setAttribute("content", THEME_COLORS[theme]));
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setThemeState(readTheme());
    setMounted(true);
  }, []);

  // Follow system changes while the user has not made an explicit choice.
  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => {
      if (localStorage.getItem(THEME_STORAGE_KEY)) return;
      const next: Theme = event.matches ? "dark" : "light";
      applyTheme(next);
      setThemeState(next);
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    applyTheme(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* storage unavailable — theme still applies for this session */
    }
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(readTheme() === "dark" ? "light" : "dark");
  }, [setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, mounted, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
