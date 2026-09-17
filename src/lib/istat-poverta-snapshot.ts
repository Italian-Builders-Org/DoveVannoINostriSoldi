import "server-only";

import dataArtifact from "@/data/generated/istat-poverta-assoluta-2014-2024.data.json";
import metadataArtifact from "@/data/generated/istat-poverta-assoluta-2014-2024.meta.json";
import {
  validateIstatPovertaBundle,
  type IstatPovertaData,
  type IstatPovertaMetadata,
} from "@/lib/data/istat-poverta-contract";
import { createPovertaQuery } from "@/lib/istat-poverta-query";

const validated = validateIstatPovertaBundle(dataArtifact, metadataArtifact);

export const istatPovertaData: IstatPovertaData = validated.data;
export const istatPovertaMetadata: IstatPovertaMetadata = validated.metadata;

export type { IstatPovertaQuery, IstatPovertaQueryResult } from "@/lib/istat-poverta-query";

export const queryIstatPovertaAssoluta = createPovertaQuery(istatPovertaData, istatPovertaMetadata);
