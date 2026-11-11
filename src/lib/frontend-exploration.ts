type DirectoryGroup = Readonly<{
  title: string;
  links: readonly Readonly<{ href: string; label: string }>[];
}>;

function searchText(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("it-IT");
}

/** All words must match a page's label or its section; accents are optional. */
export function filterDirectory(groups: readonly DirectoryGroup[], query: string): DirectoryGroup[] {
  const words = searchText(query).trim().split(/\s+/).filter(Boolean);
  return groups.map((group) => ({
    ...group,
    links: group.links.filter((link) => {
      const text = searchText(`${group.title} ${link.label}`);
      return words.every((word) => text.includes(word));
    }),
  })).filter((group) => group.links.length > 0);
}

/** Share the current environment and filters, never an authentication credential. */
export function shareableViewUrl(href: string): string {
  const url = new URL(href);
  url.username = "";
  url.password = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(?:code|token|access_token|refresh_token|id_token|authorization|_vercel_share|x-vercel-protection-bypass)$/i.test(key)) {
      url.searchParams.delete(key);
    }
  }
  if (/^#(?:access_token|id_token|token)=/i.test(url.hash)) url.hash = "";
  return url.href;
}
