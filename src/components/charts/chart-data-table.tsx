export type ChartTableRow = {
  label: string;
  values: string[];
};

export function ChartDataTable({
  label,
  columns,
  rows,
}: {
  label: string;
  columns: string[];
  rows: ChartTableRow[];
}) {
  return (
    <details className="chart-data">
      <summary>Dati del grafico in tabella</summary>
      <div className="table-scroll" role="region" aria-label={label} tabIndex={0}>
        <table className="table">
          <caption className="table-caption">{label}</caption>
          <thead>
            <tr>
              <th scope="col">Voce</th>
              {columns.map((column) => <th scope="col" className="num" key={column}>{column}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                {row.values.map((value, index) => <td className="num" key={`${row.label}-${index}`}>{value}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
