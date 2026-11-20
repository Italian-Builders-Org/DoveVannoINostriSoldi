import { permanentRedirect } from "next/navigation";

export default function LegacyStateBudgetRedirect() {
  permanentRedirect("/studi/bilancio-stato-2025");
}
