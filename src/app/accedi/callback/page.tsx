import type { Metadata } from "next";
import { AccediCallbackClient } from "./callback-client";

export const metadata: Metadata = {
  title: "Completamento accesso",
  robots: { index: false, follow: false },
};

export default function AccediCallbackPage() {
  return (
    <main data-immersive-page="boards" data-testid="accedi-callback">
      <AccediCallbackClient />
    </main>
  );
}
