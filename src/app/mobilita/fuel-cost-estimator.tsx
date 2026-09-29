"use client";

import { useState } from "react";
import styles from "./mobilita.module.css";

type FuelPrice = Readonly<{ label: string; price: number }>;

function parseAmount(value: string): number | null {
  const amount = Number(value.trim().replace(",", "."));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

const euro = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const percent = new Intl.NumberFormat("it-IT", {
  style: "percent",
  maximumFractionDigits: 1,
});

export function FuelCostEstimator({ prices }: Readonly<{ prices: readonly FuelPrice[] }>) {
  const [fuelIndex, setFuelIndex] = useState(0);
  const [distance, setDistance] = useState("12000");
  const [consumption, setConsumption] = useState("6,5");
  const [price, setPrice] = useState(String(prices[0]?.price ?? ""));
  const [monthlyBudget, setMonthlyBudget] = useState("");

  const distanceAmount = parseAmount(distance);
  const consumptionAmount = parseAmount(consumption);
  const priceAmount = parseAmount(price);
  const budgetAmount = parseAmount(monthlyBudget);
  const annualLitres = distanceAmount !== null && consumptionAmount !== null
    ? (distanceAmount * consumptionAmount) / 100
    : null;
  const annualCost = annualLitres !== null && priceAmount !== null ? annualLitres * priceAmount : null;
  const budgetShare = annualCost !== null && budgetAmount !== null
    ? annualCost / (budgetAmount * 12)
    : null;

  function changeFuel(value: string) {
    const nextIndex = Number(value);
    const nextFuel = prices[nextIndex];
    if (!nextFuel) return;
    setFuelIndex(nextIndex);
    setPrice(String(nextFuel.price));
  }

  return (
    <div className={styles.calculatorGrid}>
      <div className={styles.inputGrid}>
        <label className={styles.field}>
          <span>Carburante</span>
          <select value={fuelIndex} onChange={(event) => changeFuel(event.target.value)}>
            {prices.map((item, index) => <option value={index} key={item.label}>{item.label}</option>)}
          </select>
        </label>
        <label className={styles.field}>
          <span>Prezzo al litro (€)</span>
          <input
            type="text"
            inputMode="decimal"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            aria-describedby="input-privacy-note"
          />
        </label>
        <label className={styles.field}>
          <span>Chilometri annui</span>
          <input
            type="text"
            inputMode="numeric"
            value={distance}
            onChange={(event) => setDistance(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span>Consumo medio (L/100 km)</span>
          <input
            type="text"
            inputMode="decimal"
            value={consumption}
            onChange={(event) => setConsumption(event.target.value)}
          />
        </label>
        <label className={`${styles.field} ${styles.budgetField}`}>
          <span>Spesa familiare mensile (€) · facoltativa</span>
          <input
            type="text"
            inputMode="decimal"
            placeholder="Inserisci un importo"
            value={monthlyBudget}
            onChange={(event) => setMonthlyBudget(event.target.value)}
          />
        </label>
        <p className={styles.inputPrivacy} id="input-privacy-note">
          I valori restano in questa pagina e non vengono inviati. Puoi modificare anche il prezzo di riferimento.
        </p>
      </div>

      <div className={styles.estimateResult} aria-live="polite" aria-atomic="true">
        <span className={styles.resultLabel}>Stima carburante</span>
        {annualCost === null ? (
          <p className={styles.resultEmpty}>Inserisci valori maggiori di zero per calcolare la spesa.</p>
        ) : (
          <>
            <strong>{euro.format(annualCost)}<small> / anno</small></strong>
            <span className={styles.monthlyCost}>{euro.format(annualCost / 12)} al mese</span>
            <span className={styles.litres}>{Math.round(annualLitres!).toLocaleString("it-IT")} litri stimati all’anno</span>
          </>
        )}
        <div className={styles.budgetResult}>
          <span>Quota della spesa familiare</span>
          <strong>{budgetShare === null ? "Non disponibile" : percent.format(budgetShare)}</strong>
          <small>
            {budgetShare === null
              ? "Inserisci la spesa mensile per calcolare la quota sul totale annuo."
              : "Stima carburante annua divisa per la spesa familiare annua inserita."}
          </small>
        </div>
      </div>
    </div>
  );
}
