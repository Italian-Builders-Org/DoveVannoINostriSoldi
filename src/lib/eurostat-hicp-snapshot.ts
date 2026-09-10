import rawData from "@/data/generated/eurostat-hicp-2022-2026.data.json";
import rawMetadata from "@/data/generated/eurostat-hicp-2022-2026.meta.json";
import {
  validateEurostatHicpData,
  validateEurostatHicpMetadata,
} from "@/lib/data/eurostat-hicp-contract";

export const eurostatHicpData = validateEurostatHicpData(rawData);
export const eurostatHicpMetadata = validateEurostatHicpMetadata(rawMetadata);
