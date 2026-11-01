import "server-only";
import { GridFSBucket, ObjectId } from "mongodb";
import { db } from "./db/client";

export async function bucket() {
  return new GridFSBucket(await db(), { bucketName: "screenshots" });
}

export const ALLOWED_IMAGES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export async function saveImage(file: File, meta: Record<string, unknown>): Promise<string> {
  if (!ALLOWED_IMAGES.includes(file.type)) throw new Error("รองรับเฉพาะรูป PNG, JPEG, WebP หรือ GIF");
  if (file.size > 8 * 1024 * 1024) throw new Error("รูปใหญ่เกิน 8 MB");
  const b = await bucket();
  const id = new ObjectId();
  const up = b.openUploadStreamWithId(id, file.name || "screenshot.png", { metadata: { contentType: file.type, ...meta } });
  const data = Buffer.from(await file.arrayBuffer());
  await new Promise<void>((resolve, reject) => {
    up.on("finish", () => resolve());
    up.on("error", reject);
    up.end(data);
  });
  return id.toHexString();
}

export async function deleteImage(id: string) {
  if (!ObjectId.isValid(id)) return;
  await (await bucket()).delete(new ObjectId(id)).catch(() => {});
}
