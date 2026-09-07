/** Bounded, in-memory attachment representation shared by browser and API. */
export const ATTACHMENT_MAX_FILES = 8;
export const ATTACHMENT_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_MAX_TEXT_CHARS = 80_000;
export const ATTACHMENT_MAX_IMAGE_CHARS = 450_000;
export const ATTACHMENT_MAX_PIXELS = 1536;
export const ATTACHMENT_PARSE_TIMEOUT_MS = 15_000;
export const ATTACHMENT_ACCEPT = ".png,.jpg,.jpeg,.webp,.pdf,.docx,.xlsx,.xls,.ods,.txt,.md,.csv,.tsv,.json";
export type TextAttachment = { kind: "text"; name: string; text: string; note: string };
export type ImageAttachment = { kind: "image"; name: string; data: string; mime: "image/jpeg"; width: number; height: number; note: string };
export type AiAttachment = TextAttachment | ImageAttachment;
export function attachmentTextSize(attachments: readonly AiAttachment[]) {
  return attachments.reduce((total, file) => total + (file.kind === "text" ? file.text.length : 0), 0);
}
export function attachmentLabel(file: AiAttachment) {
  return file.kind === "image" ? `${file.width} × ${file.height} · immagine` : `${file.text.length.toLocaleString("it-IT")} caratteri · testo`;
}
