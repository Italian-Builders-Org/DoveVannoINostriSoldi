import snapshotJson from "@/data/generated/consulenti-regionali.json";
import {
  assertConsulentiRegionaliSnapshot,
  queryConsulentiRegionali,
  type ConsulentiRegionaliSnapshot,
  type ConsulentiRegionaliYear,
} from "@/lib/data/consulenti-regionali-contract";

export const consulentiRegionaliSnapshot: ConsulentiRegionaliSnapshot =
  assertConsulentiRegionaliSnapshot(snapshotJson);

export function getConsulentiRegionaliYear(year?: number): ConsulentiRegionaliYear {
  return queryConsulentiRegionali(consulentiRegionaliSnapshot, year);
}

export {
  assertConsulentiRegionaliSnapshot,
  queryConsulentiRegionali,
};
export type { ConsulentiRegionaliSnapshot, ConsulentiRegionaliYear };
