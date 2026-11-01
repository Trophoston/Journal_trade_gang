import { eaRoute } from "@/lib/http/ea";
import { handleHello } from "@/lib/mt5/ingest";
import { helloSchema } from "@/lib/mt5/protocol";

export const POST = eaRoute(helloSchema, async (p) => {
  const r = await handleHello(p);
  return ["OK", `account=${r.accountId}`, `since=${r.since}`, "v=1"];
});
