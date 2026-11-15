export function formatChartTabLabel(label: string) {
  if (label === "Debito/PIL") {
    return (
      <>
        Debito/
        <wbr />
        PIL
      </>
    );
  }
  return label;
}