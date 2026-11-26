import {
  MEF_IRPEF_SWISS_BORDER_AGREEMENT_LABEL,
  MEF_IRPEF_SWISS_BORDER_AGREEMENT_URL,
  MEF_IRPEF_SWISS_BORDER_LIST_LABEL,
  MEF_IRPEF_SWISS_BORDER_LIST_URL,
  MEF_IRPEF_SWISS_BORDER_MUNICIPALITY_BODY,
  MEF_IRPEF_SWISS_BORDER_MUNICIPALITY_TITLE,
  MEF_IRPEF_SWISS_BORDER_NOTE_BODY,
  MEF_IRPEF_SWISS_BORDER_NOTE_TITLE,
} from "@/lib/mef-irpef-swiss-border-note";

type Variant = "notice" | "inline" | "municipality";

export function MefIrpefSwissBorderNote({
  variant,
  className,
}: {
  variant: Variant;
  className?: string;
}) {
  const sourceLink = (
    <a href={MEF_IRPEF_SWISS_BORDER_AGREEMENT_URL} target="_blank" rel="noopener noreferrer">
      {MEF_IRPEF_SWISS_BORDER_AGREEMENT_LABEL} ↗
    </a>
  );

  if (variant === "municipality") {
    return (
      <p className={className} data-swiss-border-zone="true">
        <strong>{MEF_IRPEF_SWISS_BORDER_MUNICIPALITY_TITLE}.</strong> {MEF_IRPEF_SWISS_BORDER_MUNICIPALITY_BODY} Fonti:{" "}
        <a href={MEF_IRPEF_SWISS_BORDER_LIST_URL} target="_blank" rel="noopener noreferrer">
          {MEF_IRPEF_SWISS_BORDER_LIST_LABEL} ↗
        </a>
        ; {sourceLink}.
      </p>
    );
  }

  if (variant === "notice") {
    return (
      <div className="notice">
        <strong>{MEF_IRPEF_SWISS_BORDER_NOTE_TITLE}</strong>
        <p>
          {MEF_IRPEF_SWISS_BORDER_NOTE_BODY} Fonte: {sourceLink}.
        </p>
      </div>
    );
  }

  return (
    <p className={className}>
      <strong>{MEF_IRPEF_SWISS_BORDER_NOTE_TITLE}.</strong> {MEF_IRPEF_SWISS_BORDER_NOTE_BODY} Fonte:{" "}
      {sourceLink}.
    </p>
  );
}