import { queryIstatPovertaRelativa } from "@/lib/istat-poverta-relativa-snapshot";
import { createPovertaRouteHandler } from "@/lib/istat-poverta-route";

export const GET = createPovertaRouteHandler(queryIstatPovertaRelativa);
