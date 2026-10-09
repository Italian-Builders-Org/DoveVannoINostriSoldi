"use client";

import { useId, useMemo, useRef, useState, useEffect } from "react";
import {
  EMPLOYER_PROFILES,
  INAIL_PRESETS,
  INPS_CONTRIBUTION_CEILING_2026_EUR,
  type EmployerProfileId,
  type InailPresetId,
} from "@/lib/paycheck-employer";
import {
  buildPaycheckCurve,
  computePaycheck,
  formatPaycheckEuro,
  formatPaycheckPercent,
  formatPaycheckRate,
  parsePaycheckAnnualGross,
  parsePaycheckMonths,
  solveAnnualGrossForAnnualNetEur,
  solveAnnualGrossForMonthlyNetEur,
  type PaycheckMissionShare,
  type PaycheckMonthCount,
  type PaycheckRegionRates,
} from "@/lib/paycheck-counter";
import {
  buildPaycheckShareCardInput,
  buildPaycheckShareCardPath,
  buildPaycheckShareMessage,
  PAYCHECK_SHARE_PATH,
} from "@/lib/paycheck-share-card";
import { PUBLIC_SITE_URL } from "@/lib/site";
import shareStyles from "@/components/share-fact/share-fact.module.css";
import { PaycheckCurveChart } from "./paycheck-curve-chart";
import { PaycheckRegionsMap } from "./paycheck-regions-map";
import styles from "./busta-paga.module.css";

function euroInput(cents: number): string {
  return String(Math.round(cents / 100));
}

function initialNet(
  regions: readonly PaycheckRegionRates[],
  regionCode: string,
  annualGrossEur: number,
  payMonths: PaycheckMonthCount,
  missions: readonly PaycheckMissionShare[],
) {
  const region = regions.find((row) => row.code === regionCode) ?? regions[0];
  const result = computePaycheck({ annualGrossEur, region, missions, payMonths });
  return {
    monthlyCents: result.monthlyNetCents,
    annualCents: result.monthlyNetCents * result.payMonths,
  };
}

type PaycheckCounterProps = {
  regions: readonly PaycheckRegionRates[];
  defaultRegionCode: string;
  defaultAnnualGrossEur: number;
  defaultPayMonths: PaycheckMonthCount;
  payMonthOptions: readonly PaycheckMonthCount[];
  missions: readonly PaycheckMissionShare[];
  budgetYear: number | null;
  taxYear: number;
};

export function PaycheckCounter({
  regions,
  defaultRegionCode,
  defaultAnnualGrossEur,
  defaultPayMonths,
  payMonthOptions,
  missions,
  budgetYear,
  taxYear,
}: PaycheckCounterProps) {
  const [annualGross, setAnnualGross] = useState(String(defaultAnnualGrossEur));
  const [monthlyGross, setMonthlyGross] = useState(
    String(Math.round(defaultAnnualGrossEur / defaultPayMonths)),
  );
  const [monthlyNet, setMonthlyNet] = useState(() =>
    euroInput(initialNet(regions, defaultRegionCode, defaultAnnualGrossEur, defaultPayMonths, missions).monthlyCents),
  );
  const [annualNet, setAnnualNet] = useState(() =>
    euroInput(initialNet(regions, defaultRegionCode, defaultAnnualGrossEur, defaultPayMonths, missions).annualCents),
  );
  const [regionCode, setRegionCode] = useState(defaultRegionCode);
  const [payMonths, setPayMonths] = useState<PaycheckMonthCount>(defaultPayMonths);
  const [employerProfileId, setEmployerProfileId] = useState<EmployerProfileId>("commerce-to-50");
  const [inailPresetId, setInailPresetId] = useState<InailPresetId>("office");
  const annualId = useId();
  const monthlyId = useId();
  const monthlyNetId = useId();
  const annualNetId = useId();
  const regionId = useId();
  const monthsId = useId();
  const profileId = useId();
  const inailId = useId();

  const region = regions.find((row) => row.code === regionCode) ?? regions[0];
  const annualGrossEur = parsePaycheckAnnualGross(annualGross);

  const computation = useMemo(
    () =>
      computePaycheck({
        annualGrossEur,
        region,
        missions,
        payMonths,
        employerProfileId,
        inailPresetId,
      }),
    [annualGrossEur, region, missions, payMonths, employerProfileId, inailPresetId],
  );

  const curve = useMemo(
    () =>
      buildPaycheckCurve({
        annualGrossEur,
        region,
        missions,
        payMonths,
        employerProfileId,
        inailPresetId,
      }),
    [annualGrossEur, region, missions, payMonths, employerProfileId, inailPresetId],
  );

  function writeNets(annual: number, months: PaycheckMonthCount, nextRegion: PaycheckRegionRates) {
    const result = computePaycheck({
      annualGrossEur: annual,
      region: nextRegion,
      missions,
      payMonths: months,
      employerProfileId,
      inailPresetId,
    });
    setMonthlyNet(euroInput(result.monthlyNetCents));
    setAnnualNet(euroInput(result.monthlyNetCents * result.payMonths));
  }

  function onAnnualChange(raw: string) {
    setAnnualGross(raw);
    const annual = Number(raw);
    if (!Number.isFinite(annual) || raw.trim() === "") return;
    setMonthlyGross(String(Math.round(annual / payMonths)));
    writeNets(annual, payMonths, region);
  }

  function onMonthlyChange(raw: string) {
    setMonthlyGross(raw);
    const monthly = Number(raw);
    if (!Number.isFinite(monthly) || raw.trim() === "") return;
    const annual = Math.round(monthly * payMonths);
    setAnnualGross(String(annual));
    writeNets(annual, payMonths, region);
  }

  function onMonthlyNetChange(raw: string) {
    setMonthlyNet(raw);
    const monthly = Number(raw);
    if (!Number.isFinite(monthly) || raw.trim() === "") return;
    const gross = solveAnnualGrossForMonthlyNetEur({
      targetMonthlyNetEur: monthly,
      region,
      missions,
      payMonths,
      employerProfileId,
      inailPresetId,
    });
    setAnnualGross(String(gross));
    setMonthlyGross(String(Math.round(gross / payMonths)));
    const result = computePaycheck({
      annualGrossEur: gross,
      region,
      missions,
      payMonths,
      employerProfileId,
      inailPresetId,
    });
    setAnnualNet(euroInput(result.monthlyNetCents * result.payMonths));
  }

  function onAnnualNetChange(raw: string) {
    setAnnualNet(raw);
    const annualTarget = Number(raw);
    if (!Number.isFinite(annualTarget) || raw.trim() === "") return;
    const gross = solveAnnualGrossForAnnualNetEur({
      targetAnnualNetEur: annualTarget,
      region,
      missions,
      payMonths,
      employerProfileId,
      inailPresetId,
    });
    setAnnualGross(String(gross));
    setMonthlyGross(String(Math.round(gross / payMonths)));
    const result = computePaycheck({
      annualGrossEur: gross,
      region,
      missions,
      payMonths,
      employerProfileId,
      inailPresetId,
    });
    setMonthlyNet(euroInput(result.monthlyNetCents));
  }

  function onMonthsChange(next: PaycheckMonthCount) {
    setPayMonths(next);
    const annual = Number(annualGross);
    if (!Number.isFinite(annual) || annualGross.trim() === "") return;
    setMonthlyGross(String(Math.round(annual / next)));
    writeNets(annual, next, region);
  }

  function onRegionChange(code: string) {
    setRegionCode(code);
    const nextRegion = regions.find((row) => row.code === code) ?? region;
    const annual = Number(annualGross);
    if (!Number.isFinite(annual) || annualGross.trim() === "") return;
    writeNets(annual, payMonths, nextRegion);
  }

  const maxMission = Math.max(...computation.missions.map((row) => row.monthlyCents), 1);

  return (
    <div className={styles.counter}>
      <form
        className={styles.controls}
        onSubmit={(event) => event.preventDefault()}
        aria-labelledby="busta-controlli-title"
      >
        <h2 id="busta-controlli-title" className="sr-only">
          Parametri busta paga
        </h2>
        <label className={styles.field} htmlFor={annualId}>
          <span>Stipendio annuo lordo (€)</span>
          <input
            id={annualId}
            type="number"
            inputMode="numeric"
            min={5000}
            max={500000}
            step={500}
            value={annualGross}
            onChange={(event) => onAnnualChange(event.target.value)}
            data-testid="paycheck-annual-gross"
          />
        </label>
        <label className={styles.field} htmlFor={monthlyId}>
          <span>Stipendio mensile lordo (€)</span>
          <input
            id={monthlyId}
            type="number"
            inputMode="decimal"
            min={100}
            max={50000}
            step={50}
            value={monthlyGross}
            onChange={(event) => onMonthlyChange(event.target.value)}
            data-testid="paycheck-monthly-gross-input"
          />
        </label>
        <label className={styles.field} htmlFor={monthlyNetId}>
          <span>Stipendio mensile netto (€)</span>
          <input
            id={monthlyNetId}
            type="number"
            inputMode="decimal"
            min={0}
            max={50000}
            step={50}
            value={monthlyNet}
            onChange={(event) => onMonthlyNetChange(event.target.value)}
            data-testid="paycheck-monthly-net-input"
          />
        </label>
        <label className={styles.field} htmlFor={annualNetId}>
          <span>Stipendio annuo netto (€)</span>
          <input
            id={annualNetId}
            type="number"
            inputMode="numeric"
            min={0}
            max={500000}
            step={500}
            value={annualNet}
            onChange={(event) => onAnnualNetChange(event.target.value)}
            data-testid="paycheck-annual-net-input"
          />
        </label>
        <label className={styles.field} htmlFor={regionId}>
          <span>Regione di domicilio fiscale</span>
          <select
            id={regionId}
            value={region.code}
            onChange={(event) => onRegionChange(event.target.value)}
            data-testid="paycheck-region"
          >
            {regions.map((row) => (
              <option key={row.code} value={row.code}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field} htmlFor={monthsId}>
          <span>Mensilità</span>
          <select
            id={monthsId}
            value={payMonths}
            onChange={(event) => onMonthsChange(parsePaycheckMonths(event.target.value))}
            data-testid="paycheck-months"
          >
            {payMonthOptions.map((count) => (
              <option key={count} value={count}>
                {count} mensilità
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field} htmlFor={profileId}>
          <span>Profilo contributi del datore</span>
          <select
            id={profileId}
            value={employerProfileId}
            onChange={(event) => setEmployerProfileId(event.target.value as EmployerProfileId)}
            data-testid="paycheck-employer-profile"
          >
            {EMPLOYER_PROFILES.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field} htmlFor={inailId}>
          <span>Tasso INAIL illustrativo</span>
          <select
            id={inailId}
            value={inailPresetId}
            onChange={(event) => setInailPresetId(event.target.value as InailPresetId)}
            data-testid="paycheck-inail"
          >
            {INAIL_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>
      </form>
      <p className={styles.hint}>
        Puoi partire dal lordo o dal netto. Il mensile e l’annuo si aggiornano insieme. Se
        inserisci un netto, la RAL è quella che ci si avvicina di più. Cambiare le mensilità tiene
        ferma la RAL.
      </p>

      <section className={styles.summary} aria-labelledby="busta-sintesi-title">
        <div>
          <h2 id="busta-sintesi-title" className="panel-title">
            Mensile stimato
          </h2>
          <p className={styles.regionLine}>{computation.region.name}</p>
          <strong className={styles.net} data-testid="paycheck-monthly-net">
            {formatPaycheckEuro(computation.monthlyNetCents)}
          </strong>
          <p className={styles.netLabel}>
            netto medio per cedolino ({taxYear}, {computation.payMonths} mensilità)
          </p>
          <p className={styles.annualNet} data-testid="paycheck-annual-net">
            Netto annuo {formatPaycheckEuro(computation.monthlyNetCents * computation.payMonths)}
          </p>
        </div>
        <dl className={styles.metrics}>
          <div>
            <dt>Lordo mensile</dt>
            <dd data-testid="paycheck-monthly-gross">
              {formatPaycheckEuro(computation.monthlyGrossCents)}
            </dd>
          </div>
          <div>
            <dt>Trattenute</dt>
            <dd>{formatPaycheckEuro(computation.totalDeductionsCents)}</dd>
          </div>
          <div>
            <dt>Tasse (IRPEF + addizionali)</dt>
            <dd>{formatPaycheckEuro(computation.monthlyTaxCents)}</dd>
          </div>
          <div>
            <dt>Oneri del datore</dt>
            <dd data-testid="paycheck-employer-monthly">
              {formatPaycheckEuro(computation.monthlyEmployerCents)}
            </dd>
          </div>
          <div>
            <dt>Costo azienda / mese</dt>
            <dd data-testid="paycheck-company-monthly">
              {formatPaycheckEuro(computation.monthlyCompanyCostCents)}
            </dd>
          </div>
        </dl>
        <PaycheckShareButton computation={computation} />
      </section>

      <PaycheckCurveChart points={curve} enteredAnnualEur={annualGrossEur} />

      <PaycheckRegionsMap
        annualGrossEur={annualGrossEur}
        payMonths={payMonths}
        regions={regions}
        missions={missions}
        selectedRegionCode={region.code}
        onSelectRegion={setRegionCode}
        taxYear={taxYear}
      />

      <section className={styles.breakdown} aria-labelledby="busta-trattenute-title">
        <h2 id="busta-trattenute-title" className="panel-title">
          Trattenute sul mensile
        </h2>
        <ul className={styles.deductionList} data-testid="paycheck-deductions">
          {computation.deductions.map((row) => (
            <li key={row.key}>
              <div>
                <strong>{row.label}</strong>
                <span>{formatPaycheckPercent(row.rate)} sul lordo</span>
              </div>
              <em>{formatPaycheckEuro(row.monthlyCents)}</em>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.breakdown} aria-labelledby="busta-datore-title">
        <h2 id="busta-datore-title" className="panel-title">
          Oneri a carico del datore
        </h2>
        <p className={styles.hint}>
          {computation.employerProfileLabel}. Questi importi non escono dal netto: il datore li
          versa o li accantona oltre la RAL. INPS è di tabella 2026, fino al massimale di{" "}
          {new Intl.NumberFormat("it-IT").format(INPS_CONTRIBUTION_CEILING_2026_EUR)} €. Il TFR è
          la retribuzione divisa per 13,5: lo 0,50% è il contributo all’INPS, il resto
          l’accantonamento. L’INAIL ({computation.inailPerMille}‰) è un tasso illustrativo, non il
          premio della posizione assicurativa.
        </p>
        {computation.inpsBaseCapped ? (
          <p className={styles.hint}>
            La RAL supera il massimale: i contributi INPS non crescono oltre quella soglia. TFR e
            INAIL in questa stima restano sulla RAL intera.
          </p>
        ) : null}
        <ul className={styles.deductionList} data-testid="paycheck-employer-lines">
          {computation.employerCharges.map((row) => (
            <li key={row.key}>
              <div>
                <strong>{row.label}</strong>
                <span>
                  {row.key === "inail"
                    ? `${computation.inailPerMille}‰ sulla RAL`
                    : `${formatPaycheckRate(row.rate)} ${
                        row.base === "inps" ? "sull’imponibile INPS" : "sulla RAL"
                      }`}
                </span>
              </div>
              <em>{formatPaycheckEuro(row.monthlyCents)}</em>
            </li>
          ))}
        </ul>
        <p className={styles.employerTotals} data-testid="paycheck-employer-total">
          Oneri annui del datore {formatPaycheckEuro(computation.annualEmployerCents)} · costo
          azienda annuo {formatPaycheckEuro(computation.annualCompanyCostCents)}
        </p>
      </section>

      <section className={styles.breakdown} aria-labelledby="busta-missioni-title">
        <h2 id="busta-missioni-title" className="panel-title">
          Dove vanno le tasse{budgetYear != null ? ` · bilancio ${budgetYear}` : ""}
        </h2>
        <p className={styles.missionIntro}>
          Ripartizione statistica illustrativa della sola IRPEF erariale mensile secondo le
          quote di stanziamento delle missioni di bilancio dello Stato (OpenBDAP, competenza
          A1). Non significa che esattamente quella cifra della tua IRPEF vada a quella
          missione. Le addizionali restano a Regione e Comune; i contributi previdenziali
          non entrano in questo riparto. Non è cassa e non è un vincolo di destinazione.
        </p>
        {computation.missions.length === 0 ? (
          <p className={styles.emptyMissions}>Quote di bilancio non disponibili in questo momento.</p>
        ) : (
          <ul className={styles.missionList} data-testid="paycheck-missions">
            {computation.missions.map((row) => (
              <li key={row.mission}>
                <div className={styles.missionHead}>
                  <strong>{row.label}</strong>
                  <span>
                    {formatPaycheckEuro(row.monthlyCents)} · {formatPaycheckPercent(row.share)}
                  </span>
                </div>
                <div
                  className={styles.missionBar}
                  style={{ width: `${Math.max(4, (row.monthlyCents / maxMission) * 100)}%` }}
                  aria-hidden="true"
                />
              </li>
            ))}
            {computation.otherMissionsCents > 0 ? (
              <li>
                <div className={styles.missionHead}>
                  <strong>Altre missioni</strong>
                  <span>
                    {formatPaycheckEuro(computation.otherMissionsCents)} ·{" "}
                    {formatPaycheckPercent(computation.otherMissionsShare)}
                  </span>
                </div>
              </li>
            ) : null}
          </ul>
        )}
      </section>
    </div>
  );
}

function PaycheckShareButton({
  computation,
}: {
  computation: ReturnType<typeof computePaycheck>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<"idle" | "download" | "native">("idle");
  const [error, setError] = useState<string | null>(null);

  const shareInput = useMemo(() => buildPaycheckShareCardInput(computation), [computation]);
  const imagePath = useMemo(() => buildPaycheckShareCardPath(shareInput), [shareInput]);
  const pageUrl = useMemo(() => new URL(PAYCHECK_SHARE_PATH, PUBLIC_SITE_URL).toString(), []);
  const shareMessage = useMemo(
    () => buildPaycheckShareMessage(shareInput, pageUrl),
    [shareInput, pageUrl],
  );
  const encodedMessage = encodeURIComponent(shareMessage);
  const encodedUrl = encodeURIComponent(pageUrl);

  const socialLinks = [
    { label: "X", href: `https://twitter.com/intent/tweet?text=${encodedMessage}` },
    { label: "WhatsApp", href: `https://wa.me/?text=${encodedMessage}` },
    {
      label: "Telegram",
      href: `https://t.me/share/url?url=${encodedUrl}&text=${encodeURIComponent(shareMessage)}`,
    },
  ];

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setCopied(false);
      setError(null);
      setBusy("idle");
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  async function fetchCardBlob(): Promise<Blob> {
    const response = await fetch(imagePath);
    if (!response.ok) throw new Error("card_fetch_failed");
    return response.blob();
  }

  async function downloadCard() {
    setBusy("download");
    setError(null);
    try {
      const blob = await fetchCardBlob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = "dvns-busta-paga.png";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      setError("Non sono riuscito a scaricare l’immagine. Riprova.");
    } finally {
      setBusy("idle");
    }
  }

  async function shareNative() {
    setBusy("native");
    setError(null);
    try {
      const blob = await fetchCardBlob();
      const file = new File([blob], "dvns-busta-paga.png", { type: "image/png" });
      const canShareFiles =
        typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });

      if (typeof navigator.share === "function" && canShareFiles) {
        await navigator.share({
          files: [file],
          text: shareMessage,
          title: "Busta paga stimata",
          url: pageUrl,
        });
        return;
      }
      if (typeof navigator.share === "function") {
        await navigator.share({ text: shareMessage, title: "Busta paga stimata", url: pageUrl });
        return;
      }
      setError("Su questo dispositivo usa «Scarica immagine» e caricala su Instagram o Stories.");
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === "AbortError") return;
      setError("Condivisione non riuscita. Prova a scaricare l’immagine.");
    } finally {
      setBusy("idle");
    }
  }

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(shareMessage);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Copia non disponibile su questo browser.");
    }
  }

  return (
    <>
      <button
        type="button"
        className={shareStyles.trigger}
        onClick={() => setOpen(true)}
        data-testid="paycheck-share"
      >
        Crea card per i social
      </button>

      <dialog
        ref={dialogRef}
        className={shareStyles.dialog}
        aria-labelledby={titleId}
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === dialogRef.current) setOpen(false);
        }}
      >
        <div className={shareStyles.inner}>
          <button
            type="button"
            className={shareStyles.close}
            aria-label="Chiudi"
            onClick={() => setOpen(false)}
          >
            ×
          </button>

          <h2 id={titleId} className={shareStyles.heading}>
            Condividi la tua busta paga stimata
          </h2>
          <p className={shareStyles.lead}>
            Scarica la card firmata Dove Vanno I Nostri Soldi (1080×1080) e postala su Instagram,
            Stories o altri social. Il link alla pagina resta nel testo.
          </p>

          <figure className={shareStyles.preview}>
            {/* eslint-disable-next-line @next/next/no-img-element -- share preview from same-origin PNG API */}
            <img
              src={imagePath}
              alt="Anteprima card busta paga Dove Vanno I Nostri Soldi"
              width={1080}
              height={1080}
            />
          </figure>

          <div className={shareStyles.actions}>
            <button
              type="button"
              className={shareStyles.primary}
              onClick={downloadCard}
              disabled={busy !== "idle"}
            >
              {busy === "download" ? "Preparazione…" : "Scarica immagine"}
            </button>
            <button
              type="button"
              className={shareStyles.secondary}
              onClick={shareNative}
              disabled={busy !== "idle"}
            >
              {busy === "native" ? "Apertura…" : "Condividi dal telefono"}
            </button>
          </div>

          <div className={shareStyles.links}>
            {socialLinks.map((link) => (
              <a key={link.label} href={link.href} target="_blank" rel="noopener noreferrer">
                {link.label}
              </a>
            ))}
            <button type="button" onClick={copyMessage}>
              {copied ? "Copiato ✓" : "Copia testo"}
            </button>
          </div>

          {error ? <p className={shareStyles.error}>{error}</p> : null}

          <small className={shareStyles.hint}>
            Stima illustrativa: non è una busta paga reale. Fonti sulla card e in pagina.
          </small>
        </div>
      </dialog>
    </>
  );
}
