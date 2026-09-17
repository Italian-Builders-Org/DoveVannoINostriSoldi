/** Browser-only, on-device dictation. No remote recognizer or audio transport. */
export type VoiceStatus = "checking" | "unsupported" | "downloadable" | "installing" | "ready" | "starting" | "listening" | "stopping" | "review" | "error";
export type VoiceUpdate = { status: VoiceStatus; message: string; transcript?: string };
type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
export interface LocalRecognition {
  processLocally: boolean;
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onresult: ((event: { results: ArrayLike<RecognitionResult> }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
export interface LocalRecognitionConstructor {
  new(): LocalRecognition;
  available(options: { langs: string[]; processLocally: true }): Promise<string>;
  install(options: { langs: string[]; processLocally: true }): Promise<boolean>;
}
const OPTIONS = { langs: ["it-IT"], processLocally: true } as const;
const ACTIVE: VoiceStatus[] = ["starting", "listening", "stopping"];

export class LocalVoiceSession {
  private status: VoiceStatus = "checking";
  private closed = false;
  private recognition: LocalRecognition | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private recordingTimer: ReturnType<typeof setTimeout> | undefined;
  private transcript = "";
  private constructorApi: LocalRecognitionConstructor | undefined;
  private update: (value: VoiceUpdate) => void;

  constructor(constructorApi: LocalRecognitionConstructor | undefined, update: (value: VoiceUpdate) => void) {
    this.constructorApi = constructorApi;
    this.update = update;
  }

  private emit(status: VoiceStatus, message: string, transcript?: string) {
    if (this.closed) return;
    this.status = status;
    this.update({ status, message, ...(transcript === undefined ? {} : { transcript }) });
  }

  private deadline(ms: number, callback: () => void) {
    clearTimeout(this.timer);
    this.timer = setTimeout(callback, ms);
  }

  private is(status: VoiceStatus) { return this.status === status; }

  async check() {
    const Api = this.constructorApi;
    if (!Api || typeof Api.available !== "function") {
      this.emit("unsupported", "Questo browser non supporta la dettatura locale. Puoi scrivere la domanda.");
      return;
    }
    this.deadline(10_000, () => this.emit("error", "Verifica non riuscita. Chiudi e riprova, oppure scrivi la domanda."));
    try {
      const available = await Api.available({ ...OPTIONS, langs: [...OPTIONS.langs] });
      if (this.closed || this.status !== "checking") return;
      clearTimeout(this.timer);
      if (available === "available") this.emit("ready", "Pronto. Il microfono è spento.");
      else if ((available === "downloadable" || available === "downloading") && typeof Api.install === "function") {
        this.emit("downloadable", "Per la dettatura locale serve il pacchetto italiano del browser.");
      } else this.emit("unsupported", "Italiano non disponibile per la dettatura locale. Puoi scrivere la domanda.");
    } catch {
      clearTimeout(this.timer);
      if (this.status === "checking") this.emit("error", "Dettatura locale non disponibile con queste impostazioni del browser.");
    }
  }

  async install() {
    if (this.closed || this.status !== "downloadable" || !this.constructorApi) return;
    this.emit("installing", "Il browser sta scaricando il pacchetto italiano. Il microfono è spento.");
    this.deadline(120_000, () => this.emit("error", "Download non completato. Puoi chiudere e riprovare più tardi."));
    try {
      const installed = await this.constructorApi.install({ ...OPTIONS, langs: [...OPTIONS.langs] });
      if (this.closed || !this.is("installing")) return;
      clearTimeout(this.timer);
      this.emit(installed ? "ready" : "error", installed
        ? "Pacchetto pronto. Premi Inizia dettatura per attivare il microfono."
        : "Il browser non ha installato il pacchetto italiano. Puoi scrivere la domanda.");
    } catch {
      clearTimeout(this.timer);
      if (this.is("installing")) this.emit("error", "Download non riuscito. Puoi scrivere la domanda.");
    }
  }

  start() {
    if (this.closed || this.status !== "ready" || !this.constructorApi) return;
    try {
      const recognition = new this.constructorApi();
      // Assigning an unknown property would silently allow a remote implementation.
      if (!("processLocally" in recognition)) {
        this.emit("unsupported", "Questo browser non garantisce la dettatura locale. Puoi scrivere la domanda.");
        return;
      }
      recognition.processLocally = true;
      if (recognition.processLocally !== true) throw new Error("local recognition unavailable");
      recognition.lang = "it-IT";
      recognition.continuous = false;
      recognition.interimResults = false;
      this.recognition = recognition;
      recognition.onstart = () => {
        if (this.status === "starting") this.emit("listening", "Microfono attivo. Parla in italiano, poi premi Termina dettatura.");
      };
      recognition.onresult = (event) => {
        if (this.closed || !ACTIVE.includes(this.status)) return;
        let text = "";
        for (let index = 0; index < event.results.length; index++) {
          const result = event.results[index];
          if (result.isFinal) text += `${text ? " " : ""}${result[0].transcript}`;
        }
        this.transcript = text.trim();
        this.emit(this.status, "Dettatura in corso. Premi Termina dettatura per spegnere il microfono e controllare il testo.", this.transcript);
      };
      recognition.onerror = (event) => {
        if (this.closed || !ACTIVE.includes(this.status)) return;
        const messages: Record<string, string> = {
          "not-allowed": "Permesso microfono negato. Puoi scrivere la domanda o cambiare i permessi del browser.",
          "audio-capture": "Microfono non disponibile. Puoi scrivere la domanda.",
          "no-speech": "Nessuna voce rilevata. Chiudi e riprova, oppure scrivi la domanda.",
          "language-not-supported": "Italiano non disponibile per la dettatura locale.",
        };
        this.finish(messages[event.error] ?? "Dettatura interrotta. Puoi controllare il testo ricevuto o scrivere la domanda.");
      };
      recognition.onend = () => {
        if (ACTIVE.includes(this.status)) this.finish();
      };
      this.emit("starting", "Attivazione del microfono: controlla la richiesta di permesso del browser.");
      this.recordingTimer = setTimeout(() => this.finish("Tempo di dettatura terminato. Controlla il testo prima di usarlo."), 30_000);
      recognition.start();
    } catch {
      this.finish("Non è stato possibile avviare la dettatura locale. Puoi scrivere la domanda.");
    }
  }

  stop() {
    if (this.closed || !["starting", "listening"].includes(this.status)) return;
    this.emit("stopping", "Chiusura del microfono e completamento della trascrizione…");
    this.deadline(3_000, () => this.finish());
    try { this.recognition?.stop(); } catch { this.finish(); }
  }

  private finish(message?: string) {
    if (this.closed) return;
    clearTimeout(this.timer);
    clearTimeout(this.recordingTimer);
    this.emit(this.transcript ? "review" : "error", message ?? (this.transcript
      ? "Microfono spento. Controlla e modifica la trascrizione."
      : "Nessun testo riconosciuto. Chiudi e riprova, oppure scrivi la domanda."), this.transcript);
    this.release();
  }

  private release() {
    const recognition = this.recognition;
    this.recognition = null;
    if (!recognition) return;
    recognition.onstart = recognition.onend = recognition.onerror = recognition.onresult = null;
    try { recognition.abort(); } catch { /* Already stopped by the browser. */ }
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
    clearTimeout(this.recordingTimer);
    this.release();
    this.transcript = "";
  }
}
