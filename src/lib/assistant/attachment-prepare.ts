import { ATTACHMENT_ACCEPT, ATTACHMENT_MAX_FILE_BYTES, ATTACHMENT_MAX_IMAGE_CHARS, ATTACHMENT_MAX_PIXELS, ATTACHMENT_PARSE_TIMEOUT_MS, type AiAttachment } from "./attachment-contracts";

async function imageAttachment(file: File, signal: AbortSignal): Promise<AiAttachment> {
  const bitmap = await createImageBitmap(file);
  try {
    signal.throwIfAborted();
    if (bitmap.width * bitmap.height > 20_000_000) throw new Error("L’immagine supera 20 megapixel. Ridimensionala prima di allegarla.");
    const scale = Math.min(1, ATTACHMENT_MAX_PIXELS / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Impossibile preparare l’immagine in questo browser.");
    context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL("image/jpeg", 0.82).split(",")[1];
    if (data.length > ATTACHMENT_MAX_IMAGE_CHARS) throw new Error("L’immagine resta troppo pesante. Ridimensionala o scegli un ritaglio più piccolo.");
    return { kind: "image", name: file.name, mime: "image/jpeg", data, width: canvas.width, height: canvas.height, note: "Immagine ottimizzata senza metadati originali. Serve un modello che legga immagini." };
  } finally { bitmap.close(); }
}

function textAttachment(file: File, bytes: ArrayBuffer, signal: AbortSignal): Promise<AiAttachment> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./attachment-extract.worker.ts", import.meta.url));
    const close = () => { worker.terminate(); signal.removeEventListener("abort", cancel); };
    const cancel = () => { close(); reject(new DOMException("Aborted", "AbortError")); };
    signal.addEventListener("abort", cancel, { once: true });
    worker.onmessage = (event: MessageEvent<{ ok: boolean; attachment: AiAttachment; message: string }>) => {
      close(); if (event.data.ok) resolve(event.data.attachment); else reject(new Error(event.data.message));
    };
    worker.onerror = () => { close(); reject(new Error("Non riesco a leggere il file in questo browser. Prova a esportarlo in TXT o PDF.")); };
    worker.postMessage({ name: file.name, bytes }, [bytes]);
  });
}

export async function prepareAttachment(file: File, signal: AbortSignal, onProgress: (value: number) => void = () => undefined): Promise<AiAttachment> {
  const extension = `.${file.name.split(".").at(-1)?.toLowerCase()}`;
  if (!ATTACHMENT_ACCEPT.split(",").includes(extension)) throw new Error("Formato non supportato. Per Word usa DOCX; per gli altri documenti PDF, Excel o testo.");
  if (!file.size || file.size > ATTACHMENT_MAX_FILE_BYTES) throw new Error("Ogni file deve contenere dati e pesare al massimo 10 MB.");
  if (!file.name.trim() || file.name.length > 180 || /[\u0000-\u001F\u007F]/u.test(file.name)) throw new Error("Rinomina il file con un nome breve e leggibile.");
  const deadline = AbortSignal.timeout(ATTACHMENT_PARSE_TIMEOUT_MS);
  const bounded = AbortSignal.any([signal, deadline]);
  bounded.throwIfAborted();
  onProgress(1);
  let abort: (() => void) | undefined;
  try {
    const work = async () => {
      if ([".png", ".jpg", ".jpeg", ".webp"].includes(extension)) { onProgress(25); const image = await imageAttachment(file, bounded); onProgress(100); return image; }
      const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        const cancel = () => reader.abort();
        bounded.addEventListener("abort", cancel, { once: true });
        reader.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.max(1, Math.round(event.loaded / event.total * 60))); };
        reader.onload = () => { bounded.removeEventListener("abort", cancel); resolve(reader.result as ArrayBuffer); };
        reader.onerror = reader.onabort = () => { bounded.removeEventListener("abort", cancel); reject(new Error("Lettura annullata o non riuscita.")); };
        reader.readAsArrayBuffer(file);
      });
      onProgress(65);
      bounded.throwIfAborted();
      if (extension === ".pdf") return (await import("./attachment-pdf")).extractPdf(file.name, bytes, bounded, (fraction) => onProgress(65 + Math.round(fraction * 35)));
      const text = await textAttachment(file, bytes, bounded); onProgress(100); return text;
    };
    return await Promise.race([work(), new Promise<never>((_, reject) => {
      abort = () => reject(new Error(deadline.aborted ? "La lettura ha superato 15 secondi. Usa un file più piccolo." : "Lettura annullata."));
      bounded.addEventListener("abort", abort, { once: true });
      if (bounded.aborted) abort();
    })]);
  } catch (error) {
    if (error instanceof Error && /^(Formato non|Ogni file|Rinomina|L’immagine|Impossibile|Non |Il |La |Salva |Questo |Lettura)/u.test(error.message)) throw error;
    throw new Error("Non riesco a leggere il file. Controlla che sia integro e senza password.");
  } finally { if (abort) bounded.removeEventListener("abort", abort); }
}
