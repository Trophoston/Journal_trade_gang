import { ObjectId } from "mongodb";
import { bucket } from "@/lib/files";

/** Streams a screenshot stored in GridFS. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!ObjectId.isValid(id)) return new Response("Not found", { status: 404 });
  const b = await bucket();
  const file = await b.find({ _id: new ObjectId(id) }).next();
  if (!file) return new Response("Not found", { status: 404 });
  const node = b.openDownloadStream(file._id);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      node.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
      node.on("end", () => controller.close());
      node.on("error", (err) => controller.error(err));
    },
    cancel() {
      node.destroy();
    },
  });
  return new Response(stream, {
    headers: { "content-type": (file.metadata?.contentType as string) ?? "image/png", "content-length": String(file.length), "cache-control": "private, max-age=31536000, immutable" },
  });
}
