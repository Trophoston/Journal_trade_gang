import { eaRoute } from "@/lib/http/ea";
import { handleCalendar } from "@/lib/mt5/ingest";
import { calendarSchema } from "@/lib/mt5/protocol";

export const POST = eaRoute(calendarSchema, async (p) => {
  const r = await handleCalendar(p);
  return `OK|${r.stored}`;
});
