import "server-only";
import dataJson from "@/data/generated/rgs-ministries-2025.data.json";
import metadataJson from "@/data/generated/rgs-ministries-2025.meta.json";
import {
  validateRgsMinistriesSnapshot,
  type RgsMinistriesData,
  type RgsMinistriesMetadata,
} from "@/lib/data/rgs-ministries-contract";

const validated = validateRgsMinistriesSnapshot(
  dataJson as RgsMinistriesData,
  metadataJson as RgsMinistriesMetadata,
);

export const rgsMinistriesSnapshot = validated.data;
export const rgsMinistriesMetadata = validated.metadata;
