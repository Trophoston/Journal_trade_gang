import { readFile } from "node:fs/promises";
import path from "node:path";

/** The MT5 Expert Advisor source, for "Download EA" in Settings. */
export async function GET() {
  try {
    const body = await readFile(path.join(process.cwd(), "mt5", "TradeGangSync.mq5"));
    return new Response(body, {
      headers: { "content-type": "text/plain; charset=utf-8", "content-disposition": 'attachment; filename="TradeGangSync.mq5"', "cache-control": "no-store" },
    });
  } catch {
    return new Response("EA file not found", { status: 404 });
  }
}
