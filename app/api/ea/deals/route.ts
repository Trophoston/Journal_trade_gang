import { eaRoute } from "@/lib/http/ea";
import { handleDeals } from "@/lib/mt5/ingest";
import { dealsSchema } from "@/lib/mt5/protocol";

export const POST = eaRoute(dealsSchema, async (p) => {
  const r = await handleDeals(p);
  return [`OK|${r.accepted}`];
});
