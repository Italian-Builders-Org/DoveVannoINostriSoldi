import * as z from "zod/v4";
import { ATTACHMENT_MAX_IMAGE_CHARS, ATTACHMENT_MAX_PIXELS, ATTACHMENT_MAX_TEXT_CHARS } from "@/lib/assistant/attachment-contracts";

const name = z.string().trim().min(1).max(180).regex(/^[^\u0000-\u001F\u007F]+$/u);
const note = z.string().max(500);
export const attachmentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), name, text: z.string().trim().min(1).max(ATTACHMENT_MAX_TEXT_CHARS), note }).strict(),
  z.object({ kind: z.literal("image"), name, mime: z.literal("image/jpeg"),
    data: z.string().min(4).max(ATTACHMENT_MAX_IMAGE_CHARS).regex(/^\/9j\/[A-Za-z0-9+/]*={0,2}$/u),
    width: z.number().int().min(1).max(ATTACHMENT_MAX_PIXELS), height: z.number().int().min(1).max(ATTACHMENT_MAX_PIXELS), note,
  }).strict(),
]);
