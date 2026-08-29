type SourceIdentity = "rgs" | "ipa" | "anac" | "istat";

type SourceIdentityMarkProps = Readonly<{
  source: SourceIdentity;
  className?: string;
}>;

const labels: Record<SourceIdentity, string> = {
  rgs: "RGS",
  ipa: "IPA",
  anac: "ANAC",
  istat: "ISTAT",
};

/**
 * Compact, project-owned source identifiers for dense overview cards.
 * They intentionally avoid reproducing protected institutional trademarks;
 * the adjacent visible label and destination expose the full source identity.
 */
export function SourceIdentityMark({ source, className }: SourceIdentityMarkProps) {
  const label = labels[source];

  return (
    <svg
      className={className}
      viewBox="0 0 68 30"
      aria-hidden="true"
      focusable="false"
      data-source-identity={source}
    >
      {source === "rgs" ? (
        <>
          <circle cx="14" cy="15" r="9" />
          <path d="M8 15h12M14 9v12" />
        </>
      ) : null}
      {source === "ipa" ? (
        <>
          <path d="M5 12 14 6l9 6M7 13h14M9 14v8M14 14v8M19 14v8M6 23h17" />
        </>
      ) : null}
      {source === "anac" ? (
        <>
          <path d="m14 5 9 4v6c0 5-3.6 8.2-9 10-5.4-1.8-9-5-9-10V9l9-4Z" />
          <path d="m10 15 3 3 6-7" />
        </>
      ) : null}
      {source === "istat" ? (
        <>
          <path d="M6 22V14M11 22V9M16 22V12M21 22V6" />
          <path d="M4 23h20" />
        </>
      ) : null}
      <text x="29" y="19">{label}</text>
    </svg>
  );
}
