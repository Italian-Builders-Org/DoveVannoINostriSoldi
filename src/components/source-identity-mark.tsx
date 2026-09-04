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
 *
 * These are deliberately original geometric marks rather than reproductions
 * of institutional logos. The adjacent label and linked source record carry
 * the actual source name and owner.
 */
export function SourceIdentityMark({ source, className }: SourceIdentityMarkProps) {
  const label = labels[source];

  return (
    <svg
      className={className}
      viewBox="0 0 52 26"
      aria-hidden="true"
      focusable="false"
      data-source-identity={source}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {source === "rgs" ? (
        <>
          <path d="M3.5 4.5h11v17h-11z" />
          <path d="M6.5 9h5M6.5 13h5M6.5 17h3.5" />
        </>
      ) : null}
      {source === "ipa" ? (
        <>
          <path d="m2.5 10 7-6 7 6M4.5 11h10M5.5 12v8M9.5 12v8M13.5 12v8M3.5 21h12" />
        </>
      ) : null}
      {source === "anac" ? (
        <>
          <path d="m9.5 3 7 3v5c0 4-2.8 6.7-7 8-4.2-1.3-7-4-7-8V6l7-3Z" />
          <path d="m6 10.5 2.3 2.3 4.7-5.2" />
        </>
      ) : null}
      {source === "istat" ? (
        <>
          <path d="M3 20V12M7 20V8M11 20V11M15 20V5" />
          <path d="M2 21.5h14" />
        </>
      ) : null}
      <text x="21" y="17">{label}</text>
    </svg>
  );
}
