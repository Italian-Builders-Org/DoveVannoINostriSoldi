/** Spezza i titoli Camera «FIRMATARIO: "oggetto" (n)» in lead + titolo leggibile. */
export function parseActHeadline(raw: string): { lead: string | null; title: string } {
  let text = raw.replace(/\s+/gu, " ").trim();
  if (!text) return { lead: null, title: raw };

  text = text.replace(/^S\.\s*[\dA-Za-z-]+\.\s*-\s*/u, "");
  text = text.replace(/\s*\((?:approvata[^)]*|[\dA-Za-z-]+)\)\s*$/iu, "").trim();

  const quoted = text.match(/^(.+?):\s*[«"“](.+)[»"”]\s*$/u);
  if (quoted) {
    return {
      lead: formatActLead(quoted[1]),
      title: quoted[2].replace(/\s+/gu, " ").trim(),
    };
  }
  return { lead: null, title: text };
}

function formatActLead(value: string): string {
  return value
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/\p{L}+/gu, (word) => {
      if (/^(ed|e|altri|altra|altre|degli|delle|della|dello|dei|del|di|da|per)$/iu.test(word)) {
        return word.toLocaleLowerCase("it-IT");
      }
      return word.charAt(0).toLocaleUpperCase("it-IT") + word.slice(1).toLocaleLowerCase("it-IT");
    });
}
