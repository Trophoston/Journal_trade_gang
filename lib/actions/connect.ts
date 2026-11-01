"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { createLink, MetaApiError, removeLink, syncLink } from "../connectors/metaapi";
import { cols } from "../db/collections";
import { getSettings, updateSettings } from "../settings";

type Result = { ok: true } | { ok: false; error: string };

const fail = (err: unknown): Result => ({
  ok: false,
  error: err instanceof Error ? err.message : "Something went wrong",
});

export async function saveMetaApiToken(token: string): Promise<Result> {
  const t = z.string().trim().min(20, "That doesn't look like a MetaApi token.").max(4000).safeParse(token);
  if (!t.success) return { ok: false, error: t.error.issues[0].message };
  await updateSettings({ metaapiToken: t.data });
  refresh();
  return { ok: true };
}

const linkInput = z.object({
  login: z.coerce.number().int().positive("Account number is digits only."),
  server: z.string().trim().min(3, "Server name, e.g. Exness-MT5Trial9."),
  password: z.string().min(4, "Enter the investor password.").max(200),
  name: z.string().trim().max(60).default(""),
});

/** Create the read-only cloud link. The password is passed straight to MetaApi and not stored here. */
export async function connectMetaApi(input: z.input<typeof linkInput>): Promise<Result> {
  const p = linkInput.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const token = (await getSettings()).metaapiToken;
  if (!token) return { ok: false, error: "บันทึก MetaApi token ก่อน" };
  const c = await cols();
  if (await c.links.findOne({ login: p.data.login, server: p.data.server })) return { ok: false, error: "บัญชีนี้เชื่อมไว้แล้ว" };
  try {
    const link = await createLink({ token, ...p.data });
    void syncLink(link);
  } catch (err) {
    return fail(err instanceof MetaApiError ? err : new Error("ติดต่อ MetaApi ไม่ได้ ตรวจสอบการเชื่อมต่ออินเทอร์เน็ต"));
  }
  refresh();
  return { ok: true };
}

export async function syncMetaApiNow(id: string): Promise<Result> {
  const c = await cols();
  const link = await c.links.findOne({ _id: z.string().parse(id) });
  if (!link) return { ok: false, error: "ไม่พบการเชื่อมนี้" };
  try {
    await syncLink(link, { forceDeals: true });
  } catch (err) {
    return fail(err);
  }
  refresh();
  const after = await c.links.findOne({ _id: link._id });
  return after?.status === "error" ? { ok: false, error: after.lastError ?? "Sync ล้มเหลว" } : { ok: true };
}

/** Unlink and delete the account at MetaApi (so it no longer holds the password). Synced trades stay. */
export async function removeMetaApiLink(id: string): Promise<Result> {
  try {
    await removeLink(z.string().parse(id));
  } catch (err) {
    return fail(err);
  }
  refresh();
  return { ok: true };
}
