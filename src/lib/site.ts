/**
 * Fixed addresses of the project itself, as opposed to the public sources it
 * reads. Kept in one place so a link that appears in the header, the footer
 * and the sources page cannot drift apart.
 */

export const REPO_URL = "https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi";
export const PUBLIC_SITE_URL = "https://www.dovevannoinostrisoldi.com";
export const PUBLIC_MCP_ENDPOINT = `${PUBLIC_SITE_URL}/api/mcp`;
export const BUY_ME_A_COFFEE_URL = "https://www.buymeacoffee.com/dovevannoinostrisoldi";
export const GOOGLE_ANALYTICS_MEASUREMENT_ID = "G-6NKJM5HWR4";

export const SOCIAL_LINKS = [
  { id: "threads", label: "Threads", href: "https://www.threads.com/@dovevannoinostrisoldi" },
  { id: "facebook", label: "Facebook", href: "https://www.facebook.com/profile.php?id=61593922084084" },
  { id: "instagram", label: "Instagram", href: "https://www.instagram.com/dovevannoinostrisoldi/" },
  { id: "tiktok", label: "TikTok", href: "https://www.tiktok.com/@dovevannoinostrisoldi" },
  { id: "x", label: "X", href: "https://x.com/DVNSoldi" },
] as const;
