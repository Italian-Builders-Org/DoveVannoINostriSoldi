import "server-only";

import dataArtifact from "@/data/generated/istat-poverta-relativa-2014-2024.data.json";
import metadataArtifact from "@/data/generated/istat-poverta-relativa-2014-2024.meta.json";
import {
  validateIstatPovertaRelativaBundle,
  type IstatPovertaData,
  type IstatPovertaMetadata,
} from "@/lib/data/istat-poverta-contract";
import { createPovertaQuery } from "@/lib/istat-poverta-query";

const validated = validateIstatPovertaRelativaBundle(dataArtifact, metadataArtifact);

export const istatPovertaRelativaData: IstatPovertaData = validated.data;
export const istatPovertaRelativaMetadata: IstatPovertaMetadata = validated.metadata;

export const queryIstatPovertaRelativa = createPovertaQuery(
  istatPovertaRelativaData,
  istatPovertaRelativaMetadata,
);
