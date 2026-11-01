"use client";

import { ExternalLink, KeyRound, Loader2, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/chip";
import { Field, Input } from "@/components/ui/field";
import { connectMetaApi, removeMetaApiLink, saveMetaApiToken, syncMetaApiNow } from "@/lib/actions/connect";
import type { SettingsData } from "@/lib/queries/settings";
import { useNow } from "@/lib/ui/use-now";

type Meta = SettingsData["metaapi"];

const STATUS: Record<Meta["links"][number]["status"], { label: string; tone: "green" | "blue" | "red" | "metal" }> = {
  live: { label: "Live", tone: "green" },
  connecting: { label: "กำลังเชื่อมต่อโบรกเกอร์…", tone: "blue" },
  deploying: { label: "กำลังเริ่มบน cloud…", tone: "blue" },
  error: { label: "ต้องตรวจสอบ", tone: "red" },
};

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3 rounded-[var(--radius-inner)] bg-blue-soft/50 px-4 py-3 text-[13px] leading-relaxed text-fg-2 ring-1 ring-blue/15 ring-inset">
      <ShieldCheck className="mt-0.5 size-4 shrink-0 text-blue-ink" />
      <div>{children}</div>
    </div>
  );
}

/** Login + investor password, synced through MetaApi's cloud MT5 — no MT5 app or EA needed. */
export function MetaApiPanel({ meta }: { meta: Meta }) {
  const [token, setToken] = useState("");
  const [form, setForm] = useState({
    login: "",
    server: "",
    password: "",
    name: "",
  });
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const now = useNow() ?? 0;

  const saveToken = () =>
    start(async () => {
      const r = await saveMetaApiToken(token);
      if (!r.ok) return void toast.error(r.error);
      setToken("");
      toast.success("บันทึก MetaApi token แล้ว");
    });

  const connect = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await connectMetaApi(form);
      if (!r.ok)
        return void toast.error("เชื่อมบัญชีไม่ได้", {
          description: r.error,
        });
      setForm({ login: "", server: "", password: "", name: "" });
      toast.success("เชื่อมบัญชีแล้ว", {
        description: "MetaApi กำลังเริ่มบัญชีบน cloud ประวัติจะเข้ามาภายในไม่กี่นาที",
      });
    });
  };

  const act = (id: string, fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) => {
    setBusy(id);
    void fn().then((r) => {
      setBusy(null);
      if (r.ok) toast.success(done);
      else toast.error(r.error);
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <Note>
        ใช้ <b className="font-medium text-fg">investor password (อ่านอย่างเดียว)</b> ห้ามใช้รหัสหลัก รหัสนี้ดูเทรดได้แต่เปิดออเดอร์ไม่ได้ รหัสจะส่งไปที่{" "}
        <a href="https://metaapi.cloud" target="_blank" rel="noreferrer" className="text-blue-ink hover:underline">
          MetaApi
        </a>{" "}
        ครั้งเดียวเพื่อล็อกอิน และไม่ถูกเก็บใน Trade Gang MetaApi จะเก็บไว้เพื่อคงการเชื่อมต่อ ถ้าลบการเชื่อมที่นี่ ที่นั่นก็จะถูกลบด้วย วิธีนี้ไม่มีข่าวจากปฏิทินเศรษฐกิจ
      </Note>

      {meta.links.length > 0 && (
        <div className="flex flex-col gap-2">
          {meta.links.map((l) => {
            const s = STATUS[l.status];
            return (
              <div key={l.id} className="flex flex-wrap items-center gap-3 rounded-[var(--radius-inner)] bg-surface-2/70 px-4 py-3 ring-1 ring-line ring-inset">
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-medium">
                    {l.name || "MT5"} · {l.login}
                  </span>
                  <span className="block text-[12px] text-fg-3">
                    {l.server} · ผ่าน MetaApi
                    {l.lastSyncAt && now ? ` · sync ล่าสุด ${Math.max(0, Math.round((now - l.lastSyncAt) / 1000))} วินาทีที่แล้ว` : ""}
                  </span>
                  {l.lastError && <span className="mt-1 block text-[12px] text-red-ink">{l.lastError}</span>}
                </span>
                <Badge tone={s.tone}>{s.label}</Badge>
                <Button variant="ghost" size="icon" aria-label="Sync ตอนนี้" disabled={busy === l.id} onClick={() => act(l.id, () => syncMetaApiNow(l.id), "Sync แล้ว")}>
                  {busy === l.id ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="ยกเลิกการเชื่อม"
                  disabled={busy === l.id}
                  onClick={() => {
                    if (confirm(`ยกเลิกการเชื่อม ${l.login}? บัญชีจะถูกลบจาก MetaApi ด้วย เทรดที่ sync มาแล้วยังอยู่ใน journal`)) act(l.id, () => removeMetaApiLink(l.id), "ยกเลิกการเชื่อมและลบจาก MetaApi แล้ว");
                  }}
                >
                  <Trash2 />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <Field
        label="1 · MetaApi token"
        hint={
          <>
            สมัครฟรีที่{" "}
            <a href="https://app.metaapi.cloud/token" target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-blue-ink hover:underline">
              app.metaapi.cloud/token <ExternalLink className="size-3" />
            </a>
             เก็บไว้ในฐานข้อมูลบนเครื่องนี้เท่านั้น {meta.tokenHint ? `บันทึกแล้ว (${meta.tokenHint})` : ""}
          </>
        }
      >
        <div className="flex gap-1.5">
          <Input
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={meta.tokenHint ? "วาง token ใหม่เพื่อแทนที่" : "วาง token ของคุณ"}
            aria-label="MetaApi token"
            className="font-mono text-[13px]"
          />
          <Button variant="soft" disabled={pending || !token.trim()} onClick={saveToken}>
            <KeyRound /> บันทึก
          </Button>
        </div>
      </Field>

      <form onSubmit={connect} className="flex flex-col gap-4">
        <div className="text-[14px] font-medium">2 · บัญชี MT5 ของคุณ</div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="เลขบัญชี" hint="Exness Personal Area → My accounts">
            <Input
              inputMode="numeric"
              autoComplete="off"
              value={form.login}
              onChange={(e) => setForm({ ...form, login: e.target.value.replace(/\D/g, "") })}
              placeholder="เช่น 277001234"
              aria-label="เลขบัญชี"
              className="num"
            />
          </Field>
          <Field label="Server" hint="พิมพ์ให้ตรงตามที่แสดง เช่น Exness-MT5Trial9 หรือ Exness-MT5Real8">
            <Input autoComplete="off" value={form.server} onChange={(e) => setForm({ ...form, server: e.target.value })} placeholder="Exness-MT5…" aria-label="Server" />
          </Field>
          <Field label="Investor password" hint="Personal Area → บัญชี ⋯ → Set investor password">
            <Input type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} aria-label="Investor password" />
          </Field>
          <Field label="ชื่อ (ไม่บังคับ)">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Gold scalping" aria-label="ชื่อบัญชี" />
          </Field>
        </div>
        <div>
          <Button type="submit" variant="primary" disabled={pending || !meta.tokenHint || !form.login || !form.server || !form.password}>
            {pending ? <Loader2 className="animate-spin" /> : <ShieldCheck />} เชื่อมแบบอ่านอย่างเดียว
          </Button>
          {!meta.tokenHint && <span className="ml-3 text-[12.5px] text-fg-3">บันทึก token ก่อน</span>}
        </div>
      </form>
    </div>
  );
}

/** Exness's own API: not wired yet because its developer docs are only visible after signing in. */
export function ExnessApiPanel() {
  return (
    <div className="flex flex-col gap-4 text-[13.5px] leading-relaxed text-fg-2">
      <Note>Exness มี API key + secret ใน Personal Area ตอนนี้มีเฉพาะไทยและเวียดนาม และใช้ได้เฉพาะบัญชีเทรดของ Exness เอง บัญชี MT5 ปกติใช้ไม่ได้</Note>
      <ol className="flex flex-col gap-2 pl-5 [list-style:decimal]">
        <li>
          เปิด{" "}
          <a href="https://my.exness.com" target="_blank" rel="noreferrer" className="text-blue-ink hover:underline">
            Exness Personal Area
          </a>{" "}
          → <b className="font-medium text-fg">API</b> แล้วดูว่าบัญชีของคุณสร้าง key ได้ไหม
        </li>
        <li>ถ้าได้ ให้เปิด Developer Portal ที่ลิงก์ไว้ Trade Gang ต้องใช้ endpoint ของประวัติ position และ balance เพื่อ sync</li>
        <li>ระหว่างนี้ใช้ล็อกอินผ่าน MetaApi หรือ EA ไปก่อน ทั้งสองแบบได้ journal และ AI เหมือนกัน</li>
      </ol>
      <div>
        <Badge tone="metal">ยังไม่พร้อมใช้งาน</Badge>
      </div>
    </div>
  );
}
