import rawData from "@/data/generated/oecd-taxing-wages-2000-2025.data.json";
import rawMetadata from "@/data/generated/oecd-taxing-wages-2000-2025.meta.json";
import {
  validateOecdTaxingWagesData,
  validateOecdTaxingWagesMetadata,
} from "@/lib/data/oecd-taxing-wages-contract";

export const oecdTaxingWagesData = validateOecdTaxingWagesData(rawData);
export const oecdTaxingWagesMetadata = validateOecdTaxingWagesMetadata(rawMetadata);
