const envLogo = (import.meta.env?.["VITE_BRAND_LOGO_URL"] as string | undefined)?.trim();

export const CROSX_SITE_URL = "https://rca.crosx.in";

export const CROSX_LOGO_URL =
  envLogo ||
  "https://xtprixndtsnctglngxwl.supabase.co/storage/v1/object/public/email-assets/1000229222.png";
