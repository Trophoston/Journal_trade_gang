import { z } from "zod";
import { chatTurn } from "@/lib/ai/chat";

const bodySchema = z.object({
  threadId: z.string().optional(),
  scopeKey: z.string().min(1).max(200),
  reportId: z.string().optional(),
  message: z.string().trim().min(1).max(4000),
});

/** Streams one chat turn as NDJSON lines. */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid message" }, { status: 400 });
  const enc = new TextEncoder();
  const it = chatTurn(parsed.data);
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await it.next();
        if (done) return controller.close();
        controller.enqueue(enc.encode(`${JSON.stringify(value)}\n`));
      } catch (err) {
        controller.enqueue(enc.encode(`${JSON.stringify({ type: "error", message: err instanceof Error ? err.message : String(err) })}\n`));
        controller.close();
      }
    },
    async cancel() {
      await it.return(undefined);
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
