import "../../tests/helpers/register-ts-alias.mjs";
const { monthlyReports } = await import("../../src/lib/monthly-reports.ts");
const { formatReportPeriod, formatReportValue } = await import("../../src/lib/monthly-report-format.ts");

export function monthlyReportMarkdown(report) {
  const sourceLinks = (ids) => ids.map((id) => `[Fonte](#fonte-${id})`).join(" · ");
  const section = (value) => `## ${value.title}\n\n${value.paragraphs.map((p) => `${p.text}\n\n${sourceLinks(p.evidenceIds)}`).join("\n\n")}`;
  const escape = (value) => String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
  const figure = (value) => `## ${value.title}\n\n${value.takeaway}\n\n${value.accessibleSummary}\n\n| Voce | ${value.series.map((s) => escape(s.label)).join(" | ")} |\n| --- | ${value.series.map(() => "---:").join(" | ")} |\n${value.rows.map((row) => `| ${escape(row.label)} | ${value.series.map((s) => escape(formatReportValue(row.values[s.id]))).join(" | ")} |`).join("\n")}\n\nPeriodo: ${formatReportPeriod(value.referencePeriod)}. Perimetro: ${value.perimeter}\n\n${value.denominator ? `Denominatore: ${value.denominator}.\n\n` : ""}${value.caveat}\n\n${sourceLinks(value.evidenceIds)}`;
  return [
    `# ${report.title}\n\nIl mese dei soldi pubblici · ${report.issueMonth}\n\n${report.dek}\n\nRedazione DVNS · Data editoriale di pubblicazione: ${report.publication.publishedOn} · Cutoff: ${report.publication.dataCutoff} · Revisione: ${report.contentRevision}`,
    "## In breve\n\n" + report.inBrief.map((id) => {
      const fact = report.facts.find((item) => item.id === id);
      return `### ${fact.label}\n\n${formatReportValue(fact.value)}\n\n${fact.plainLanguage}\n\nPeriodo: ${formatReportPeriod(fact.referencePeriod)}. Perimetro: ${fact.perimeter}\n\n${fact.denominator ? `Denominatore: ${fact.denominator}.\n\n` : ""}${fact.caveat}\n\n${sourceLinks(fact.evidenceIds)}`;
    }).join("\n\n"),
    section(report.lead), figure(report.figures[0]), section(report.rubrics.numbers), figure(report.figures[1]),
    section(report.rubrics.territories), section(report.rubrics.signal), section(report.rubrics.sources),
    "## Schede delle fonti\n\n" + report.evidence.map((e) => `<a id="fonte-${e.id}"></a>\n\n### ${e.publisher} · ${e.title}\n\n[Fonte pubblica](${e.publicUrl})\n\nDataset: ${e.datasetId}. Periodo: ${formatReportPeriod(e.referencePeriod)}. Verifica: ${e.checkedOn}.\n\n${e.perimeter}\n\n${e.caveat}\n\nRevisione Git: \`${e.dataRevision}\`\n\nSHA-256: \`${e.artifactSha256}\``).join("\n\n"),
    report.reviewers.length ? `Revisori e contributori: ${report.reviewers.join(", ")}.` : "",
    section(report.rubrics.nextMonth),
    report.corrections.length ? "## Correzioni\n\n" + report.corrections.map((c) => `${c.publishedOn}: ${c.explanation}`).join("\n\n") : "",
  ].filter(Boolean).join("\n\n") + "\n";
}

if (process.argv[1]?.endsWith("export-monthly-report.mjs")) {
  const report = monthlyReports.getPublished(process.argv[2]);
  if (!report) throw new Error("Edizione pubblicata non trovata");
  process.stdout.write(monthlyReportMarkdown(report));
}
