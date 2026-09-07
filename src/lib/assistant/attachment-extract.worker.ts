import { ATTACHMENT_MAX_TEXT_CHARS, type TextAttachment } from "./attachment-contracts";

function cleanText(value: string) {
  const text = value.replace(/\r\n?/gu, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/gu, "").trim();
  if (!text) throw new Error("Non trovo testo leggibile. Per una scansione, allega le pagine come immagini.");
  if (text.length > ATTACHMENT_MAX_TEXT_CHARS) throw new Error("Il documento supera 80.000 caratteri. Seleziona una parte più breve: non taglio il contenuto automaticamente.");
  return text;
}

async function extract(name: string, bytes: ArrayBuffer): Promise<TextAttachment> {
  const extension = name.split(".").at(-1)?.toLowerCase();
  let text = "", note = "Testo completo del file.";
  if (extension === "docx") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ arrayBuffer: bytes });
    text = result.value;
    note = "Testo Word; immagini, grafici e formattazione esclusi.";
  } else if (["xlsx", "xls", "ods"].includes(extension ?? "")) {
    const { read } = await import("xlsx");
    const book = read(bytes, { type: "array", cellFormula: true, cellText: true, cellHTML: false, cellStyles: false, bookVBA: false });
    if (book.SheetNames.length > 10) throw new Error("Il foglio di calcolo supera 10 schede. Allega un estratto più piccolo.");
    let cells = 0;
    for (const name of book.SheetNames) {
      text += `\n\n[Scheda ${name}]\n`;
      for (const [address, cell] of Object.entries(book.Sheets[name])) {
        if (address.startsWith("!") || (!cell.f && cell.v === undefined)) continue;
        if (++cells > 5000) throw new Error("Il foglio supera 5.000 celle valorizzate. Seleziona le righe utili in un file più piccolo.");
        const value = cell.v === undefined ? "[formula senza risultato salvato]" : String(cell.v);
        text += `${address}\t${value}${cell.w && cell.w !== value ? ` (visualizzato: ${cell.w})` : ""}${cell.f ? " [risultato salvato di una formula]" : ""}\n`;
        if (text.length > ATTACHMENT_MAX_TEXT_CHARS) cleanText(text);
      }
    }
    if (!cells) throw new Error("Il foglio di calcolo non contiene celle leggibili.");
    note = `${book.SheetNames.length} ${book.SheetNames.length === 1 ? "scheda" : "schede"}, ${cells} celle. Formule non ricalcolate; grafici, immagini e formattazione esclusi.`;
  } else if (["txt", "md", "csv", "tsv", "json"].includes(extension ?? "")) {
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw new Error("Salva il file di testo in UTF-8 e riprova."); }
    if (text.includes("\u0000")) throw new Error("Questo file non sembra testo UTF-8 leggibile.");
  } else throw new Error("Formato non supportato. Usa PDF, DOCX, Excel, TXT, CSV, Markdown, JSON o un’immagine.");
  return { kind: "text", name, text: cleanText(text), note };
}

self.onmessage = (event: MessageEvent<{ name: string; bytes: ArrayBuffer }>) => {
  // Dedicated Worker.postMessage uses an empty origin. If an origin is supplied,
  // accept only this worker's own origin, never a different web origin.
  if (event.origin !== "" && event.origin !== self.location.origin) return;
  void extract(event.data.name, event.data.bytes).then(
    (attachment) => self.postMessage({ ok: true, attachment }),
    (error: unknown) => self.postMessage({ ok: false, message: error instanceof Error && /^(Non trovo|Il documento|Il PDF|La pagina|Il foglio|Salva il file|Questo file|Formato non)/u.test(error.message) ? error.message : "Non riesco a leggere il file. Potrebbe essere danneggiato, protetto da password o non supportato." }),
  );
};
