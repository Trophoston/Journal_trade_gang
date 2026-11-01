import { eaRoute } from "@/lib/http/ea";
import { handleCandles } from "@/lib/mt5/ingest";
import { candlesSchema } from "@/lib/mt5/protocol";

export const POST = eaRoute(candlesSchema, async (p) => {
  const r = await handleCandles(p);
  return `OK|${r.stored}`;
});
