import "server-only";
import dataJson from "@/data/generated/pcm-financial-2024.data.json";
import metadataJson from "@/data/generated/pcm-financial-2024.meta.json";
import {
  validatePcmFinancialSnapshot,
  type PcmFinancialData,
  type PcmFinancialMetadata,
} from "@/lib/data/pcm-financial-contract";

const validated = validatePcmFinancialSnapshot(
  dataJson as PcmFinancialData,
  metadataJson as PcmFinancialMetadata,
);

export const pcmFinancialSnapshot = validated.data;
export const pcmFinancialMetadata = validated.metadata;
