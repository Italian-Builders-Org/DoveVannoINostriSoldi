import { ATTACHMENT_MAX_TEXT_CHARS, type TextAttachment } from "./attachment-contracts";

/** PDF interpretation stays in a dedicated worker; no document bytes reach a server. */
export async function extractPdf(name: string, bytes: ArrayBuffer, signal: AbortSignal, onProgress: (fraction: number) => void): Promise<TextAttachment> {
  const pdfjs = await import("pdfjs-dist");
  signal.throwIfAborted();
  const port = new Worker(new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url), { type: "module" });
  pdfjs.GlobalWorkerOptions.workerPort = port;
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, useWorkerFetch: false, disableFontFace: true });
  const cancel = () => { void task.destroy(); port.terminate(); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 30) throw new Error("Il PDF supera 30 pagine. Allega un estratto più breve.");
    let text = "";
    for (let number = 1; number <= pdf.numPages; number++) {
      signal.throwIfAborted();
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      const value = content.items.map((item) => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join("").trim();
      if (!value) throw new Error(`La pagina ${number} non contiene testo leggibile. Per le scansioni usa immagini PNG o JPEG.`);
      text += `\n\n[Pagina ${number}]\n${value}`;
      if (text.length > ATTACHMENT_MAX_TEXT_CHARS) throw new Error("Il PDF supera 80.000 caratteri. Seleziona una parte più breve: non taglio il contenuto automaticamente.");
      page.cleanup();
      onProgress(number / pdf.numPages);
    }
    return { kind: "text", name, text: text.trim(), note: `${pdf.numPages} ${pdf.numPages === 1 ? "pagina" : "pagine"}: solo testo; immagini, grafici e impaginazione non vengono letti.` };
  } finally {
    signal.removeEventListener("abort", cancel);
    await task.destroy();
    port.terminate();
  }
}
