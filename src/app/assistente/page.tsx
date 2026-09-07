import type { Metadata } from "next";
import { AssistantChat } from "@/components/assistant-chat";

export const metadata: Metadata = {
  title: "Assistente sui dati pubblici",
  description: "Conversa sui dati pubblici con la tua API key personale. Fonti, periodi e limiti, con dettatura locale nei browser compatibili.",
};

export default function AssistantPage() {
  return <AssistantChat />;
}
