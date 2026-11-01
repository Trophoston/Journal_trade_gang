"use client";

import { AnimatePresence, motion } from "motion/react";
import { Check, Copy, Download, Eye, EyeOff, Loader2, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "@/components/ui/toast";
import { setAppearance, useAppearance } from "@/components/shell/appearance";
import { Button } from "@/components/ui/button";
import { ExnessApiPanel, MetaApiPanel } from "@/components/settings/cloud-connect";
import { Badge } from "@/components/ui/chip";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { SaveIndicator } from "@/components/ui/save-state";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { deleteDemoData, geminiModels, regenerateToken, saveAccount, saveSettings } from "@/lib/actions/settings";
import type { SettingsData } from "@/lib/queries/settings";
import { cn } from "@/lib/ui/cn";
import { spring } from "@/lib/ui/motion";
import { useAutosave } from "@/lib/ui/use-autosave";
import { useNow } from "@/lib/ui/use-now";
import { useStore } from "@/lib/ui/store";

type S = SettingsData["settings"];

function Row({ label, hint, children, className }: { label: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2 border-t border-line py-4 first:border-t-0 first:pt-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6", className)}>
      <div className="min-w-0">
        <div className="text-[14px] font-medium">{label}</div>
        {hint && <div className="mt-0.5 text-[12.5px] text-fg-3">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  return {
    copied,
    copy: async (text: string, key: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(key);
        setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600);
      } catch {
        toast.error("คัดลอกไม่ได้ ลองเลือกข้อความแล้วกด ⌘C");
      }
    },
  };
}

function ago(ms: number, now: number) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s} วินาทีที่แล้ว`;
  if (s < 3600) return `${Math.round(s / 60)} นาทีที่แล้ว`;
  if (s < 86_400) return `${Math.round(s / 3600)} ชม. ที่แล้ว`;
  return `${Math.round(s / 86_400)} วันที่แล้ว`;
}

// ───────────────────────── Connection

export function ConnectionSettings({ token: initial, accounts, metaapi }: { token: string; accounts: SettingsData["accounts"]; metaapi: SettingsData["metaapi"] }) {
  const [method, setMethod] = useState<"ea" | "login" | "exness">(metaapi.links.length ? "login" : "ea");
  const [token, setToken] = useState(initial);
  const [show, setShow] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const { copied, copy } = useCopy();
  const now = useNow() ?? 0;
  const live = useStore((st) => st.live);
  const mt5 = accounts.filter((a) => a.source === "mt5");
  const url = "http://127.0.0.1:3685";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        {mt5.length === 0 ? (
          <div className="flex items-center gap-3 rounded-[var(--radius-inner)] bg-surface-2/70 px-4 py-3 ring-1 ring-line ring-inset">
            <span className="relative grid size-2.5 place-items-center">
              <span className="absolute size-2.5 animate-ping rounded-full bg-amber/60" />
              <span className="size-2 rounded-full bg-amber" />
            </span>
            <span className="text-[13.5px]">ยังไม่ได้เชื่อมต่อบัญชี MT5 เลือกวิธีด้านล่าง การเชื่อมต่อครั้งแรกจะดึงประวัติทั้งหมดเข้ามา</span>
          </div>
        ) : (
          mt5.map((a) => {
            const seen = Math.max(a.lastSeenAt ?? 0, live[a.id]?.at ?? 0) || null;
            const flag = live[a.id]?.connected;
            const isLive = seen !== null && now > 0 && flag !== false && now - seen < (flag ? 90_000 : 30_000);
            return (
              <div key={a.id} className="flex flex-wrap items-center gap-3 rounded-[var(--radius-inner)] bg-surface-2/70 px-4 py-3 ring-1 ring-line ring-inset">
                <span className={cn("size-2 rounded-full", isLive ? "bg-green shadow-[0_0_0_4px_var(--green-soft)]" : "bg-metal")} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-medium">
                    {a.name} · {a.login}
                  </span>
                  <span className="block text-[12px] text-fg-3">
                    {a.server} · {a.eaVersion === "metaapi" ? "via MetaApi" : `EA v${a.eaVersion ?? "?"}`} · {a.trades} trades
                  </span>
                </span>
                <Badge tone={isLive ? "green" : "metal"}>{isLive ? "Live" : seen ? `เห็นล่าสุด ${ago(seen, now || seen)}` : "ยังไม่เคยเชื่อมต่อ"}</Badge>
              </div>
            );
          })
        )}
      </div>

      <Segmented
        label="วิธีเชื่อมต่อ"
        value={method}
        onChange={setMethod}
        className="self-start"
        options={[
          { value: "ea", label: "MT5 app + EA" },
          { value: "login", label: "ล็อกอิน (MetaApi)" },
          { value: "exness", label: "Exness API key" },
        ]}
      />

      {method === "login" && <MetaApiPanel meta={metaapi} />}
      {method === "exness" && <ExnessApiPanel />}
      {method === "ea" && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="EA token" hint="วางในช่อง Token ของ EA ใครมี Token นี้ก็เขียนเทรดเข้า journal ของคุณได้">
              <div className="flex gap-1.5">
                <Input readOnly value={show ? token : "•".repeat(Math.min(24, token.length))} className="font-mono text-[13px]" aria-label="EA token" onFocus={(e) => show && e.currentTarget.select()} />
                <Button variant="soft" size="icon" aria-label={show ? "ซ่อน Token" : "แสดง Token"} onClick={() => setShow((v) => !v)}>
                  {show ? <EyeOff /> : <Eye />}
                </Button>
                <Button variant="soft" size="icon" aria-label="คัดลอก Token" onClick={() => copy(token, "token")}>
                  {copied === "token" ? <Check className="text-green-ink" /> : <Copy />}
                </Button>
              </div>
            </Field>
            <Field label="Server URL" hint="EA ส่งข้อมูลมาที่ที่อยู่นี้ เพิ่ม 127.0.0.1 ในรายการที่อนุญาตของ MT5">
              <div className="flex gap-1.5">
                <Input readOnly value={url} className="font-mono text-[13px]" aria-label="Server URL" />
                <Button variant="soft" size="icon" aria-label="คัดลอก URL" onClick={() => copy(url, "url")}>
                  {copied === "url" ? <Check className="text-green-ink" /> : <Copy />}
                </Button>
              </div>
            </Field>
          </div>

          <div className="flex flex-wrap gap-2">
            <a
              href="/api/download/ea"
              download
              className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-control)] bg-blue px-4 text-sm font-medium text-white shadow-[0_1px_0_0_rgb(255_255_255/0.25)_inset,0_6px_16px_-8px_var(--blue)] transition-[filter,transform] hover:brightness-110 active:scale-[0.97]"
            >
              <Download className="size-4" /> ดาวน์โหลด TradeGangSync.mq5
            </a>
            {confirm ? (
              <Button
                variant="danger"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const t = await regenerateToken();
                    setToken(t);
                    setShow(true);
                    setConfirm(false);
                    toast.success("สร้าง Token ใหม่แล้ว", {
                      description: "วางใน input ของ EA Token เดิมใช้ไม่ได้แล้วตั้งแต่ตอนนี้",
                    });
                  })
                }
              >
                {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />} ยืนยัน (EA จะหลุดการเชื่อมต่อ)
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setConfirm(true)}>
                <RefreshCw /> Token ใหม่
              </Button>
            )}
            {confirm && (
              <Button variant="ghost" onClick={() => setConfirm(false)}>
                ยกเลิก
              </Button>
            )}
          </div>

          <ol className="flex flex-col gap-3 text-[13.5px] text-fg-2">
            {[
              <>
                ใน MT5: <b className="font-medium text-fg">File → Open Data Folder → MQL5 → Experts</b> แล้ววาง <code className="rounded bg-surface-3 px-1 font-mono text-[12px]">TradeGangSync.mq5</code> ไว้ที่นั่น
              </>,
              <>
                เปิดใน MetaEditor (F4) แล้วกด <b className="font-medium text-fg">Compile</b> (F7)
              </>,
              <>
                <b className="font-medium text-fg">Tools → Options → Expert Advisors</b>: ติ๊ก “Allow WebRequest for listed URL” แล้วเพิ่ม{" "}
                <code className="rounded bg-surface-3 px-1 font-mono text-[12px]">http://127.0.0.1</code> (MT5 ใช้รายการนี้กับ socket ด้วย)
              </>,
              <>
                ลาก EA ไปวางบน<b className="font-medium text-fg">กราฟไหนก็ได้ 1 กราฟ</b> วาง Token แล้วกด OK EA จะดูทั้งบัญชีและไม่เปิดออเดอร์เด็ดขาด
              </>,
              <>
                หน้านี้จะขึ้น <b className="font-medium text-green-ink">Live</b> ภายในไม่กี่วินาที แล้วประวัติจะทยอยเข้ามา
              </>,
            ].map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="num grid size-6 shrink-0 place-items-center rounded-full bg-blue-soft text-[12px] font-semibold text-blue-ink">{i + 1}</span>
                <span className="pt-0.5 leading-relaxed">{step}</span>
              </li>
            ))}
          </ol>
          <p className="text-[12px] text-fg-3">
            MT5 อยู่อีกเครื่อง (Windows PC หรือ VM)? เปิดแอปด้วย <code className="font-mono">pnpm dev -H 0.0.0.0</code> ใช้ LAN address ของ Mac เครื่องนี้ในช่อง Host ของ EA
            แล้วเพิ่มในรายการที่อนุญาตของ MT5
          </p>
        </>
      )}
    </div>
  );
}

// ───────────────────────── Accounts

function AccountCard({ a, active }: { a: SettingsData["accounts"][number]; active: boolean }) {
  const [v, setV] = useState({
    name: a.name,
    isCent: a.isCent,
    mode: a.serverTime.mode,
    fixed: a.serverTime.fixedOffsetMin ?? 120,
    rules: a.rules,
  });
  const { state, queue } = useAutosave<Parameters<typeof saveAccount>[1]>((patch) => saveAccount(a.id, patch));
  // Save only what was edited: the page may be older than the account (the EA can mark it cent meanwhile).
  const set = (patch: Partial<typeof v>) => {
    const next = { ...v, ...patch };
    setV(next);
    queue({
      ...("name" in patch ? { name: next.name } : {}),
      ...("isCent" in patch ? { isCent: next.isCent } : {}),
      ...("mode" in patch || "fixed" in patch ? { serverTime: { mode: next.mode, fixedOffsetMin: next.fixed } } : {}),
      ...("rules" in patch ? { rules: next.rules } : {}),
    });
  };
  const rule = (k: keyof typeof v.rules, raw: string) => {
    const n = raw === "" ? undefined : Number(raw);
    set({
      rules: {
        ...v.rules,
        [k]: n !== undefined && Number.isFinite(n) ? n : undefined,
      },
    });
  };
  const observed = a.serverTime.observedOffsetMin;
  return (
    <div className="rounded-[var(--radius-inner)] bg-surface-2/60 p-4 ring-1 ring-line ring-inset">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-[15px] font-semibold">{a.login || "Demo"}</span>
        <span className="text-[12.5px] text-fg-3">
          {a.server} · {a.currency} · {a.trades} เทรด
        </span>
        {a.source === "demo" && <Badge tone="violet">ข้อมูลตัวอย่าง</Badge>}
        {a.tradeMode === "real" && <Badge tone="amber">Real</Badge>}
        {active && <Badge tone="blue">กำลังแสดง</Badge>}
        <span className="ml-auto">
          <SaveIndicator state={state} />
        </span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="ชื่อ">
          <Input value={v.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} />
        </Field>
        <Field label="เวลา Server" hint={observed !== undefined ? `ตอนนี้ EA รายงาน GMT${observed >= 0 ? "+" : "−"}${Math.abs(observed / 60)}` : undefined}>
          <Select value={v.mode} onChange={(e) => set({ mode: e.target.value as typeof v.mode })}>
            <option value="auto">อัตโนมัติ (GMT+2/+3 ตาม DST ของ New York)</option>
            <option value="ny">DST ของ New York</option>
            <option value="eu">DST ของยุโรป</option>
            <option value="fixed">กำหนด offset เอง</option>
          </Select>
        </Field>
        {v.mode === "fixed" ? (
          <Field label="Offset (นาทีจาก GMT)">
            <Input type="number" step={30} value={v.fixed} onChange={(e) => set({ fixed: Number(e.target.value) || 0 })} />
          </Field>
        ) : (
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-3 text-[13.5px]">
              <Switch checked={v.isCent} onCheckedChange={(isCent) => set({ isCent })} label="บัญชี Cent" />
              บัญชี Cent <span className="text-fg-3">(÷100 เพื่อแสดงเป็นดอลลาร์)</span>
            </label>
          </div>
        )}
        <Field label="Risk ต่อเทรด %">
          <Input type="number" step="0.1" min={0} placeholder="ใช้ค่าเริ่มต้น" value={v.rules.riskPerTradePct ?? ""} onChange={(e) => rule("riskPerTradePct", e.target.value)} />
        </Field>
        <Field label="จำนวนเทรดสูงสุดต่อวัน">
          <Input type="number" min={0} placeholder="ใช้ค่าเริ่มต้น" value={v.rules.maxTradesPerDay ?? ""} onChange={(e) => rule("maxTradesPerDay", e.target.value)} />
        </Field>
        <Field label="ขีดจำกัดขาดทุนต่อวัน %">
          <Input type="number" step="0.1" min={0} placeholder="ใช้ค่าเริ่มต้น" value={v.rules.dailyLossLimitPct ?? ""} onChange={(e) => rule("dailyLossLimitPct", e.target.value)} />
        </Field>
      </div>
    </div>
  );
}

export function AccountsSettings({ accounts, activeId }: { accounts: SettingsData["accounts"]; activeId: string | null }) {
  if (!accounts.length) return <p className="text-[13px] text-fg-3">บัญชีจะขึ้นที่นี่เมื่อ EA เชื่อมต่อ</p>;
  return (
    <div className="flex flex-col gap-3">
      {accounts.map((a) => (
        <AccountCard key={a.id} a={a} active={a.id === activeId} />
      ))}
    </div>
  );
}

// ───────────────────────── Journal defaults (rules, time, symbols)

const TIMEZONES = ["Asia/Bangkok", "Asia/Singapore", "Asia/Tokyo", "Asia/Dubai", "Europe/London", "Europe/Berlin", "America/New_York", "America/Chicago", "Australia/Sydney", "UTC"];

export function JournalSettings({ s }: { s: S }) {
  const [v, setV] = useState({
    timezone: s.timezone,
    minSample: s.minSample,
    rules: s.rules,
    symbolMap: Object.entries(s.symbolMap),
    pipSizes: Object.entries(s.pipSizes),
  });
  const { state, queue } = useAutosave<Parameters<typeof saveSettings>[0]>(saveSettings);
  const set = (patch: Partial<typeof v>) => {
    const next = { ...v, ...patch };
    setV(next);
    queue({
      timezone: next.timezone,
      minSample: next.minSample,
      rules: next.rules,
      symbolMap: Object.fromEntries(next.symbolMap.filter(([k, val]) => k && val)),
      pipSizes: Object.fromEntries(next.pipSizes.filter(([k, val]) => k && val > 0).map(([k, val]) => [k, Number(val)])),
    });
  };
  const rule = (k: keyof S["rules"], raw: string | boolean) =>
    set({
      rules: {
        ...v.rules,
        [k]: typeof raw === "boolean" ? raw : Number(raw) || 0,
      },
    });

  return (
    <div className="flex flex-col">
      <div className="mb-2 flex justify-end">
        <SaveIndicator state={state} />
      </div>
      <Row label="Time zone ของคุณ" hint="กราฟ ปฏิทิน และเวลา session จะแสดงตาม zone นี้ วันเทรดยังคงจบที่ 17:00 New York">
        <Select value={v.timezone} onChange={(e) => set({ timezone: e.target.value })} className="w-56">
          {(TIMEZONES.includes(v.timezone) ? TIMEZONES : [v.timezone, ...TIMEZONES]).map((z) => (
            <option key={z}>{z}</option>
          ))}
        </Select>
      </Row>
      <Row label="จำนวนตัวอย่างขั้นต่ำ" hint="กลุ่มที่มีเทรดน้อยกว่านี้จะไม่ถูกเรียกว่าจุดแข็งหรือจุดอ่อน ทั้งจากสถิติและจาก AI">
        <Input
          type="number"
          min={3}
          max={50}
          value={v.minSample}
          onChange={(e) =>
            set({
              minSample: Math.min(50, Math.max(3, Number(e.target.value) || 8)),
            })
          }
          className="w-24"
        />
      </Row>
      <div id="rules" className="scroll-mt-24" />
      <Row label="Risk ต่อเทรด" hint="ค่าเริ่มต้นของทุกบัญชี">
        <div className="flex items-center gap-2">
          <Input type="number" step="0.1" min={0} value={v.rules.riskPerTradePct} onChange={(e) => rule("riskPerTradePct", e.target.value)} className="w-24" />
          <span className="text-[13px] text-fg-3">%</span>
        </div>
      </Row>
      <Row label="จำนวนเทรดสูงสุดต่อวัน">
        <Input type="number" min={0} value={v.rules.maxTradesPerDay} onChange={(e) => rule("maxTradesPerDay", e.target.value)} className="w-24" />
      </Row>
      <Row label="ขีดจำกัดขาดทุนต่อวัน" hint="มาตรวัดในภาพรวมจะเป็นสีแดง และ Brief จะบอกให้หยุด">
        <div className="flex items-center gap-2">
          <Input type="number" step="0.1" min={0} value={v.rules.dailyLossLimitPct} onChange={(e) => rule("dailyLossLimitPct", e.target.value)} className="w-24" />
          <span className="text-[13px] text-fg-3">%</span>
        </div>
      </Row>
      <Row label="ช่วงงดเทรดรอบข่าว" hint="เฉพาะข่าวแรง (high-impact)">
        <div className="flex items-center gap-2">
          <Input type="number" min={0} max={240} value={v.rules.newsBlackoutMin} onChange={(e) => rule("newsBlackoutMin", e.target.value)} className="w-24" />
          <span className="text-[13px] text-fg-3">นาที</span>
        </div>
      </Row>
      <Row label="ต้องมี Stop loss เสมอ" hint="เทรดที่ไม่มี SL นับเป็นการทำผิดกฎ">
        <Switch checked={v.rules.requireStopLoss} onCheckedChange={(c) => rule("requireStopLoss", c)} label="บังคับใช้ Stop loss" />
      </Row>
      <div id="symbols" className="scroll-mt-24" />
      <Row label="ชื่อ Symbol" hint="ตัด suffix ของโบรกเกอร์ให้อัตโนมัติ (XAUUSDm → XAUUSD) เพิ่ม mapping เมื่อชื่อไม่ตรง เช่น USTEC → NAS100" className="sm:items-start">
        <KeyValue rows={v.symbolMap} onChange={(symbolMap) => set({ symbolMap })} left="Symbol ของโบรก" right="แสดงเป็น" parse={(x) => x.toUpperCase()} />
      </Row>
      <Row label="ขนาด Pip" hint="ใส่เฉพาะเมื่อค่าเริ่มต้นผิด (ทอง 0.1, คู่ JPY 0.01, อื่น ๆ 0.0001)" className="sm:items-start">
        <KeyValue rows={v.pipSizes.map(([k, n]) => [k, String(n)])} onChange={(rows) => set({ pipSizes: rows.map(([k, n]) => [k, Number(n)]) })} left="Symbol" right="Pip" parse={(x) => x} />
      </Row>
    </div>
  );
}

function KeyValue({ rows, onChange, left, right, parse }: { rows: [string, string | number][]; onChange: (rows: [string, string][]) => void; left: string; right: string; parse: (x: string) => string }) {
  const list = rows.map(([k, val]) => [k, String(val)] as [string, string]);
  return (
    <div className="flex w-full flex-col gap-1.5 sm:w-72">
      {list.map(([k, val], i) => (
        <div key={i} className="flex gap-1.5">
          <Input aria-label={left} placeholder={left} value={k} onChange={(e) => onChange(list.map((r, j) => (j === i ? [e.target.value.toUpperCase(), r[1]] : r)))} className="h-9 font-mono text-[13px]" />
          <Input aria-label={right} placeholder={right} value={val} onChange={(e) => onChange(list.map((r, j) => (j === i ? [r[0], parse(e.target.value)] : r)))} className="h-9 font-mono text-[13px]" />
          <Button variant="ghost" size="icon-sm" className="mt-0.5" aria-label="ลบ" onClick={() => onChange(list.filter((_, j) => j !== i))}>
            <X />
          </Button>
        </div>
      ))}
      <Button variant="ghost" size="sm" className="self-start" onClick={() => onChange([...list, ["", ""]])}>
        <Plus /> เพิ่ม
      </Button>
    </div>
  );
}

// ───────────────────────── Tags & playbook

const TAG_GROUPS: { key: keyof S["tags"]; label: string; hint: string }[] = [
  {
    key: "setups",
    label: "Setups",
    hint: "1 อันต่อเทรด Insights จะจัดอันดับให้",
  },
  {
    key: "confluences",
    label: "Confluences",
    hint: "ทุกอย่างที่สอดคล้องกัน",
  },
  {
    key: "emotions",
    label: "อารมณ์",
    hint: "ความรู้สึกตอนเข้าเทรด",
  },
  {
    key: "mistakes",
    label: "ข้อผิดพลาด",
    hint: "Insights จะรวมว่าแต่ละอย่างทำให้เสียเท่าไร",
  },
];

export function TagSettings({ s }: { s: S }) {
  const [tags, setTags] = useState(s.tags);
  const [playbook, setPlaybook] = useState(s.playbook);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const { state, queue } = useAutosave<Parameters<typeof saveSettings>[0]>(saveSettings);
  const update = (next: S["tags"]) => {
    setTags(next);
    queue({ tags: next });
  };
  const add = (k: keyof S["tags"]) => {
    const t = (draft[k] ?? "").trim();
    if (!t || tags[k].includes(t)) return;
    update({ ...tags, [k]: [...tags[k], t] });
    setDraft((d) => ({ ...d, [k]: "" }));
  };
  const savePlaybook = (next: S["playbook"]) => {
    setPlaybook(next);
    queue({ playbook: next });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end">
        <SaveIndicator state={state} />
      </div>
      {TAG_GROUPS.map((g) => (
        <div key={g.key} className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <span className="text-[14px] font-medium">{g.label}</span>
            <span className="text-[12px] text-fg-3">{g.hint}</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <AnimatePresence initial={false}>
              {tags[g.key].map((t) => (
                <motion.span
                  key={t}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={spring.snappy}
                  className="inline-flex h-8 items-center gap-1 rounded-full bg-surface-3/80 pr-1 pl-3 text-[13px] ring-1 ring-line ring-inset"
                >
                  {t}
                  <button
                    type="button"
                    aria-label={`ลบ ${t}`}
                    onClick={() =>
                      update({
                        ...tags,
                        [g.key]: tags[g.key].filter((x) => x !== t),
                      })
                    }
                    className="grid size-6 place-items-center rounded-full text-fg-3 hover:bg-surface hover:text-fg"
                  >
                    <X className="size-3" />
                  </button>
                </motion.span>
              ))}
            </AnimatePresence>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                add(g.key);
              }}
              className="flex"
            >
              <input
                value={draft[g.key] ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [g.key]: e.target.value }))}
                placeholder="เพิ่ม…"
                aria-label={`เพิ่ม ${g.label}`}
                maxLength={60}
                className="h-8 w-28 rounded-full bg-transparent px-3 text-[13px] ring-1 ring-line-strong ring-inset outline-none placeholder:text-fg-3 focus:w-44 focus:ring-2 focus:ring-blue"
                style={{ transition: "width 200ms" }}
              />
            </form>
          </div>
        </div>
      ))}
      <div className="flex flex-col gap-3 border-t border-line pt-5">
        <div className="flex items-baseline justify-between">
          <span className="text-[14px] font-medium">Playbook</span>
          <span className="text-[12px] text-fg-3">AI จะเช็กเทรดของแต่ละ setup กับ checklist ของมัน</span>
        </div>
        {playbook.map((p, i) => (
          <div key={i} className="grid gap-2 rounded-[var(--radius-inner)] bg-surface-2/60 p-3 ring-1 ring-line ring-inset sm:grid-cols-[220px_1fr_auto]">
            <Select aria-label="Setup" value={p.name} onChange={(e) => savePlaybook(playbook.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}>
              {(tags.setups.includes(p.name) ? tags.setups : [p.name, ...tags.setups]).map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
            <Textarea
              aria-label="Checklist บรรทัดละข้อ"
              rows={Math.max(3, p.rules.length)}
              value={p.rules.join("\n")}
              onChange={(e) => savePlaybook(playbook.map((x, j) => (j === i ? { ...x, rules: e.target.value.split("\n") } : x)))}
              className="min-h-20 text-[13px]"
            />
            <Button variant="ghost" size="icon-sm" aria-label="ลบรายการ playbook" onClick={() => savePlaybook(playbook.filter((_, j) => j !== i))}>
              <Trash2 />
            </Button>
          </div>
        ))}
        <Button
          variant="soft"
          size="sm"
          className="self-start"
          onClick={() =>
            savePlaybook([
              ...playbook,
              {
                name: tags.setups.find((s) => !playbook.some((p) => p.name === s)) ?? tags.setups[0] ?? "Setup",
                rules: [""],
              },
            ])
          }
        >
          <Plus /> เพิ่ม checklist ของ setup
        </Button>
      </div>
    </div>
  );
}

// ───────────────────────── AI

export function AiSettings({ s, ai }: { s: S; ai: SettingsData["ai"] }) {
  const [v, setV] = useState(s.ai);
  const [models, setModels] = useState<string[] | null>(null);
  const [loading, start] = useTransition();
  const { state, queue } = useAutosave<Parameters<typeof saveSettings>[0]>(saveSettings, 400);
  const set = (patch: Partial<S["ai"]>) => {
    const next = { ...v, ...patch };
    setV(next);
    queue({ ai: next });
  };
  const load = () =>
    start(async () => {
      const r = await geminiModels();
      if (r.ok) setModels(r.models);
      else toast.error("โหลดรายชื่อ model ไม่ได้", { description: r.error });
    });

  return (
    <div className="flex flex-col">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {ai.provider === "mock" ? <Badge tone="amber">Mock AI (AI_PROVIDER=mock)</Badge> : ai.configured ? <Badge tone="green">พบ Gemini key แล้ว</Badge> : <Badge tone="red">ไม่มี GEMINI_API_KEY ใน .env.local</Badge>}
        {ai.queued > 0 && <Badge tone="violet">รอคิว {ai.queued}</Badge>}
        <span className="ml-auto">
          <SaveIndicator state={state} />
        </span>
      </div>
      {ai.failed.length > 0 && (
        <div className="mb-3 rounded-[12px] bg-red-soft px-3 py-2 text-[12.5px] text-red-ink">
          ล้มเหลวล่าสุด: {ai.failed[0].kind} — {ai.failed[0].error}
        </div>
      )}
      <Row label="ภาษา" hint="ภาษาไทยจะคงศัพท์เทรด (FVG, liquidity sweep, R) เป็นภาษาอังกฤษ">
        <Segmented
          label="ภาษาของ AI"
          value={v.language}
          onChange={(language) => set({ language })}
          options={[
            { value: "th", label: "ไทย + EN terms" },
            { value: "en", label: "English" },
          ]}
        />
      </Row>
      <Row
        label="Model"
        hint={
          <>
            Fast ใช้วิเคราะห์เทรด รีวิวรายวัน และแชต · Deep ใช้รีวิวรายสัปดาห์ · Lite รับช่วงเมื่อชน limit ของ free tier · Search ใช้ Google Search grounding ค่าเริ่มต้นเป็น model ฟรีทั้งหมด{" "}
            <button type="button" onClick={load} className="text-blue-ink hover:underline">
              {loading ? "กำลังโหลด…" : models ? `มี ${models.length} model` : "โหลดรายชื่อจาก Gemini"}
            </button>
          </>
        }
        className="sm:items-start"
      >
        <div className="flex w-full flex-col gap-2 sm:w-72">
          <Input list="tg-models" aria-label="Fast model" value={v.fastModel} onChange={(e) => set({ fastModel: e.target.value.trim() })} className="font-mono text-[13px]" />
          <Input list="tg-models" aria-label="Deep model" value={v.deepModel} onChange={(e) => set({ deepModel: e.target.value.trim() })} className="font-mono text-[13px]" />
          <Input list="tg-models" aria-label="Lite model (rate-limit fallback)" value={v.liteModel} onChange={(e) => set({ liteModel: e.target.value.trim() })} className="font-mono text-[13px]" />
          <Input list="tg-models" aria-label="Search model" value={v.searchModel} onChange={(e) => set({ searchModel: e.target.value.trim() })} className="font-mono text-[13px]" />
          <datalist id="tg-models">
            {(models ?? []).map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </div>
      </Row>
      <Row label="วิเคราะห์ทุกเทรดอัตโนมัติ" hint={`${v.analyzeDelayMin} นาทีหลังปิดเทรด หรือทันทีที่ติด tag setup + อารมณ์ รันครั้งเดียว จะไม่รันซ้ำเว้นแต่คุณกดวิเคราะห์ใหม่`}>
        <div className="flex items-center gap-3">
          <Input
            type="number"
            aria-label="หน่วงเวลา (นาที)"
            min={0}
            max={240}
            value={v.analyzeDelayMin}
            onChange={(e) =>
              set({
                analyzeDelayMin: Math.max(0, Math.min(240, Number(e.target.value) || 0)),
              })
            }
            className="h-9 w-20"
            disabled={!v.autoTrade}
          />
          <Switch tone="violet" checked={v.autoTrade} onCheckedChange={(autoTrade) => set({ autoTrade })} label="วิเคราะห์เทรดอัตโนมัติ" />
        </div>
      </Row>
      <Row label="รีวิวรายวัน" hint="หลังวันเทรดปิด 17:00 New York + 10 นาที">
        <Switch tone="violet" checked={v.autoDaily} onCheckedChange={(autoDaily) => set({ autoDaily })} label="รีวิวรายวันอัตโนมัติ" />
      </Row>
      <Row label="รีวิวรายสัปดาห์" hint="หลังตลาดปิดวันศุกร์ ใช้ Deep model">
        <Switch tone="violet" checked={v.autoWeekly} onCheckedChange={(autoWeekly) => set({ autoWeekly })} label="รีวิวรายสัปดาห์อัตโนมัติ" />
      </Row>
      <Row label="Brief เทรดถัดไป" hint="วันเทรดละครั้ง">
        <Switch tone="violet" checked={v.autoBrief} onCheckedChange={(autoBrief) => set({ autoBrief })} label="Brief รายวันอัตโนมัติ" />
      </Row>
      <Row label="ส่ง screenshot" hint="รูปกราฟที่คุณวางไว้จะส่งไป Gemini พร้อมเทรด">
        <Switch tone="violet" checked={v.sendScreenshots} onCheckedChange={(sendScreenshots) => set({ sendScreenshots })} label="ส่ง screenshot ไป Gemini" />
      </Row>
      <Row label="Google Search" hint="ดูบริบทตลาดวันละครั้ง และเมื่อราคาวิ่งโดยไม่มีข่าวในปฏิทินอธิบาย แสดงแหล่งที่มาด้วย">
        <Switch tone="violet" checked={v.useSearch} onCheckedChange={(useSearch) => set({ useSearch })} label="ใช้ Google Search grounding" />
      </Row>
      <Row label="ใช้ไปวันนี้" hint="Request และ token ตั้งแต่เที่ยงคืนเวลา Pacific ซึ่งเป็นเวลาที่ quota รายวันของ Gemini รีเซ็ต">
        <a href="#usage" className="num text-[13px] text-blue-ink hover:underline">
          {ai.usageToday.requests} request · {(ai.usageToday.tokens / 1000).toFixed(1)}k token →
        </a>
      </Row>
      <details className="mt-2 rounded-[12px] bg-surface-2/60 px-4 py-3 text-[13px] text-fg-2 ring-1 ring-line ring-inset">
        <summary className="cursor-pointer font-medium text-fg">อะไรถูกส่งไป Gemini บ้าง?</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>เฉพาะเทรด วัน หรือสัปดาห์ที่กำลังวิเคราะห์: ราคา เวลา P&L, R, tag และโน้ตของคุณ</li>
          <li>หลักฐานที่ตรวจพบ (FVG, sweep, MAE/MFE) และข่าวเศรษฐกิจภายใน ±2 ชม. ไม่ใช่แท่งเทียนดิบ</li>
          <li>สถิติของคุณใน setup, session และ symbol เดียวกัน รวมถึงกฎและ playbook</li>
          <li>Screenshot ถ้าเปิดสวิตช์ด้านบน ไม่ส่งล็อกอิน รหัสผ่าน หรือ Token ของ MT5 เด็ดขาด</li>
          <li>ใน free tier ของ Gemini, Google อาจนำ prompt ไปปรับปรุง model ถ้าเรื่องนี้สำคัญให้ใช้ key แบบเสียเงิน</li>
        </ul>
      </details>
    </div>
  );
}

// ───────────────────────── Appearance

export function AppearanceSettings() {
  const a = useAppearance();
  return (
    <div className="flex flex-col">
      <Row label="ธีม">
        <Segmented
          label="ธีม"
          value={a.theme}
          onChange={(theme) => setAppearance({ theme })}
          options={[
            { value: "system", label: "ตามระบบ" },
            { value: "light", label: "สว่าง" },
            { value: "dark", label: "มืด" },
          ]}
        />
      </Row>
      <Row label="Liquid glass" hint="None จะเปิดเองอัตโนมัติเมื่อระบบตั้งค่าลดความโปร่งใส">
        <Segmented
          label="ระดับ glass"
          value={a.glass}
          onChange={(glass) => setAppearance({ glass })}
          options={[
            { value: "most", label: "Most" },
            { value: "mid", label: "Mid" },
            { value: "none", label: "None" },
          ]}
        />
      </Row>
      <Row label="แอนิเมชัน">
        <Segmented
          label="แอนิเมชัน"
          value={a.motion}
          onChange={(motion) => setAppearance({ motion })}
          options={[
            { value: "system", label: "ตามระบบ" },
            { value: "full", label: "เต็ม" },
            { value: "reduced", label: "ลดลง" },
            { value: "off", label: "ปิด" },
          ]}
        />
      </Row>
      <Row label="สีกำไร / ขาดทุน" hint="น้ำเงิน / ส้ม แยกง่ายกว่าสำหรับคนตาบอดสีแดง-เขียว">
        <Segmented
          label="ชุดสี"
          value={a.palette}
          onChange={(palette) => setAppearance({ palette })}
          options={[
            {
              value: "default",
              label: (
                <span>
                  <span className="text-green-ink">●</span> <span className="text-red-ink">●</span> เขียว / แดง
                </span>
              ),
            },
            {
              value: "cb",
              label: (
                <span>
                  <span className="text-[#3987e5]">●</span> <span className="text-[#eb6834]">●</span> น้ำเงิน / ส้ม
                </span>
              ),
            },
          ]}
        />
      </Row>
    </div>
  );
}

// ───────────────────────── Data

export function DataSettings({ hasDemo }: { hasDemo: boolean }) {
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const { copied, copy } = useCopy();
  return (
    <div className="flex flex-col">
      <Row label="สำรองข้อมูลทั้งหมด" hint="เทรด journal ประวัติ AI และ screenshot อยู่ใน MongoDB ทั้งหมด ไฟล์ archive เดียวกู้คืนได้ครบ">
        <Button variant="soft" onClick={() => copy("pnpm backup", "backup")}>
          {copied === "backup" ? <Check className="text-green-ink" /> : <Copy />}
          <code className="font-mono text-[13px]">pnpm backup</code>
        </Button>
      </Row>
      <Row
        label="กู้คืน"
        hint={
          <>
            จากไฟล์ใน ./backups: <code className="font-mono">docker exec -i trade-gang-mongo mongorestore --archive --gzip --drop &lt; backups/&lt;file&gt;</code>
          </>
        }
      >
        <span />
      </Row>
      {hasDemo && (
        <Row label="ลบข้อมูลตัวอย่าง" hint="ลบบัญชีตัวอย่างที่ seed ไว้ พร้อมเทรด แท่งเทียน ข่าว และรายงาน AI ของมัน บัญชี MT5 ของคุณจะไม่ถูกแตะต้อง">
          {confirm ? (
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setConfirm(false)}>
                ยกเลิก
              </Button>
              <Button
                variant="danger"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await deleteDemoData();
                    setConfirm(false);
                    toast.success(`ลบบัญชีตัวอย่างแล้ว ${r.removed} บัญชี`);
                  })
                }
              >
                {pending ? <Loader2 className="animate-spin" /> : <Trash2 />} ลบข้อมูลตัวอย่าง
              </Button>
            </div>
          ) : (
            <Button variant="outline" onClick={() => setConfirm(true)}>
              <Trash2 /> ลบ…
            </Button>
          )}
        </Row>
      )}
    </div>
  );
}
