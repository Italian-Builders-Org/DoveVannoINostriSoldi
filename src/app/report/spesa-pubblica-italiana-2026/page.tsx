import { permanentRedirect } from "next/navigation";

export default function LegacyPublicSpendingRedirect() {
  permanentRedirect("/studi/bilancio-stato-2025");
}
