import { eaRoute } from "@/lib/http/ea";
import { handleHeartbeat } from "@/lib/mt5/ingest";
import { heartbeatSchema } from "@/lib/mt5/protocol";
import { takeTaskLines } from "@/lib/mt5/tasks";

export const POST = eaRoute(heartbeatSchema, async (p) => {
  const { account } = await handleHeartbeat(p);
  return ["OK", ...(await takeTaskLines(account))];
});
