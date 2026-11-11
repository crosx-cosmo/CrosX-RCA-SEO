/**
 * Supabase client using the publishable key from the project environment.
 * Data stays protected by Row Level Security and security-definer functions.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const SUPABASE_PROJECT_ID =
  (import.meta.env?.["VITE_SUPABASE_PROJECT_ID"] as string | undefined)?.trim() ||
  (typeof process !== "undefined" ? process.env["SUPABASE_PROJECT_ID"]?.trim() : undefined) ||
  "";

export const SUPABASE_URL =
  (import.meta.env?.["VITE_SUPABASE_URL"] as string | undefined)?.trim() ||
  (typeof process !== "undefined" ? process.env["SUPABASE_URL"]?.trim() : undefined) ||
  (SUPABASE_PROJECT_ID ? `https://${SUPABASE_PROJECT_ID}.supabase.co` : "");

export const SUPABASE_DIRECT_URL = SUPABASE_PROJECT_ID
  ? `https://${SUPABASE_PROJECT_ID}.supabase.co`
  : "";

export const SUPABASE_PUBLISHABLE_KEY =
  (import.meta.env?.["VITE_SUPABASE_PUBLISHABLE_KEY"] as string | undefined)?.trim() ||
  (typeof process !== "undefined" ? process.env["SUPABASE_PUBLISHABLE_KEY"]?.trim() : undefined) ||
  "";

export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
}

let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (_client) return _client;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error(
      "Supabase environment variables (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY) are not configured.",
    );
  }
  const url = SUPABASE_URL;
  const key = SUPABASE_PUBLISHABLE_KEY;
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(
          typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
        );
        if (init?.headers) {
          new Headers(init.headers).forEach((v, k) => h.set(k, v));
        }
        if (
          (key.startsWith("sb_publishable_") || key.startsWith("sb_secret_")) &&
          h.get("Authorization") === `Bearer ${key}`
        ) {
          h.delete("Authorization");
        }
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
  return _client;
}

export const supabase = new Proxy({} as SupabaseClient, {
  get(_, prop, receiver) {
    const client = getClient();
    const val = Reflect.get(client, prop, receiver);
    return typeof val === "function" ? val.bind(client) : val;
  },
});
