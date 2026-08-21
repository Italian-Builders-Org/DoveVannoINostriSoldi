import { REGION_NAME_BY_ISTAT_CODE } from "@/lib/italy-regions";

const ISTAT_REGION_BY_ISO_SUBDIVISION: Readonly<Record<string, string>> = {
  "21": "01",
  "23": "02",
  "25": "03",
  "32": "04",
  "34": "05",
  "36": "06",
  "42": "07",
  "45": "08",
  "52": "09",
  "55": "10",
  "57": "11",
  "62": "12",
  "65": "13",
  "67": "14",
  "72": "15",
  "75": "16",
  "77": "17",
  "78": "18",
  "82": "19",
  "88": "20",
};

export type ItalianIpRegion = {
  istatCode: keyof typeof REGION_NAME_BY_ISTAT_CODE;
  name: string;
};

export function italianRegionFromVercelHeaders(headers: Headers): ItalianIpRegion | null {
  if (headers.get("x-vercel-ip-country")?.trim().toUpperCase() !== "IT") return null;

  const subdivision = headers
    .get("x-vercel-ip-country-region")
    ?.trim()
    .toUpperCase()
    .replace(/^IT-/, "");
  if (!subdivision) return null;

  const istatCode = ISTAT_REGION_BY_ISO_SUBDIVISION[subdivision];
  if (!istatCode || !(istatCode in REGION_NAME_BY_ISTAT_CODE)) return null;

  const typedCode = istatCode as keyof typeof REGION_NAME_BY_ISTAT_CODE;
  return { istatCode: typedCode, name: REGION_NAME_BY_ISTAT_CODE[typedCode] };
}
