import { queryIstatPovertaAssoluta } from "@/lib/istat-poverta-snapshot";
import { createPovertaRouteHandler } from "@/lib/istat-poverta-route";

export const GET = createPovertaRouteHandler(queryIstatPovertaAssoluta);
