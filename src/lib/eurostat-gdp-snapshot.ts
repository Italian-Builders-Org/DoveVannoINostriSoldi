import rawData from "@/data/generated/eurostat-gdp-2015-2026.data.json";
import rawMetadata from "@/data/generated/eurostat-gdp-2015-2026.meta.json";
import {
  validateEurostatGdpData,
  validateEurostatGdpMetadata,
} from "@/lib/data/eurostat-gdp-contract";

export const eurostatGdpData = validateEurostatGdpData(rawData);
export const eurostatGdpMetadata = validateEurostatGdpMetadata(rawMetadata);
