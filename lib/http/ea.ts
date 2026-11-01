import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { z } from "zod";
import { getSettings } from "../settings";

/** EA replies are plain text lines so MQL5 never has to parse JSON. */
export function text(lines: string[] | string, status = 200) {
  return new Response(`${Array.isArray(lines) ? lines.join("\n") : lines}\n`, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}

function sameToken(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Token check → JSON parse → Zod validation → handler. Errors come back as `ERR|message`. */
export function eaRoute<S extends z.ZodType>(schema: S, handler: (payload: z.infer<S>) => Promise<string[] | string>) {
  return async (req: Request) => {
    const settings = await getSettings().catch(() => null);
    if (!settings) return text("ERR|Database is not reachable. Start MongoDB (pnpm db:up).", 503);
    const token = req.headers.get("x-tg-token") ?? "";
    if (!token || !sameToken(token, settings.eaToken)) return text("ERR|Wrong token. Copy it from Trade Gang → Settings → MT5 connection.", 401);
    let body: unknown;
    try {
      // MQL5 char arrays can carry a trailing NUL
      body = JSON.parse((await req.text()).replace(/\0+$/, ""));
    } catch {
      return text("ERR|Body is not valid JSON", 400);
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return text(`ERR|${issue?.path.join(".") || "body"}: ${issue?.message ?? "invalid"}`, 400);
    }
    try {
      return text(await handler(parsed.data));
    } catch (err) {
      if (err instanceof Error && err.name === "EaNotice") return text(`ERR|${err.message}`, 409);
      console.error("[ea]", req.url, err);
      return text(`ERR|${err instanceof Error ? err.message : "Server error"}`, 500);
    }
  };
}
