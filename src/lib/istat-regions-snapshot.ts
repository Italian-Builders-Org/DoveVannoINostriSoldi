import "server-only";
import dataJson from "@/data/generated/istat-regions-2024.data.json";
import metadataJson from "@/data/generated/istat-regions-2024.meta.json";
import {
  validateIstatRegionsSnapshot,
  type IstatRegionsData,
  type IstatRegionsMetadata,
} from "@/lib/data/istat-regions-contract";

const validated = validateIstatRegionsSnapshot(
  dataJson as IstatRegionsData,
  metadataJson as IstatRegionsMetadata,
);

export const istatRegionsSnapshot = validated.data;
export const istatRegionsMetadata = validated.metadata;
