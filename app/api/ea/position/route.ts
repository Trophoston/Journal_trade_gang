import { eaRoute } from "@/lib/http/ea";
import { handlePositionUpdate } from "@/lib/mt5/ingest";
import { positionUpdateSchema } from "@/lib/mt5/protocol";

export const POST = eaRoute(positionUpdateSchema, async (p) => {
  await handlePositionUpdate(p);
  return "OK";
});
