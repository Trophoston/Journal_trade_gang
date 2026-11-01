"use client";

import { AnimatePresence, motion } from "motion/react";
import { ImagePlus, Loader2, Star, X } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { toast } from "@/components/ui/toast";
import { Chip } from "@/components/ui/chip";
import { Textarea } from "@/components/ui/field";
import { SaveIndicator } from "@/components/ui/save-state";
import { removeScreenshot, saveJournal, uploadScreenshot } from "@/lib/actions/journal";
import { cn } from "@/lib/ui/cn";
import { spring } from "@/lib/ui/motion";
import { useAutosave } from "@/lib/ui/use-autosave";

export interface JournalValue {
  setup: string | null;
  confluences: string[];
  emotions: string[];
  mistakes: string[];
  rating: number | null;
  followedPlan: boolean | null;
  notes: string;
  screenshots: { id: string; caption?: string }[];
}

type Patch = Partial<Omit<JournalValue, "screenshots">>;

function Group({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-medium text-fg-2">{label}</span>
        {hint && <span className="text-[11px] text-fg-3">{hint}</span>}
      </div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/** Journal for one trade. Every change autosaves; tagging setup + emotion sends the trade to the AI right away. */
export function TradeJournal({ tradeId, initial, tags }: { tradeId: string; initial: JournalValue; tags: { setups: string[]; confluences: string[]; emotions: string[]; mistakes: string[] } }) {
  const [v, setV] = useState(initial);
  const { state, queue, flush } = useAutosave<Patch>((patch) => saveJournal(tradeId, patch));
  const [uploading, startUpload] = useTransition();
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const set = (patch: Patch, immediate = false) => {
    setV((cur) => ({ ...cur, ...patch }));
    queue(patch);
    if (immediate) flush();
  };

  const upload = (files: FileList | File[]) => {
    const images = [...files].filter((f) => f.type.startsWith("image/"));
    if (!images.length) return;
    startUpload(async () => {
      for (const file of images) {
        const form = new FormData();
        form.set("tradeId", tradeId);
        form.set("file", file);
        const r = await uploadScreenshot(form);
        if (r.ok) setV((cur) => ({ ...cur, screenshots: [...cur.screenshots, { id: r.id }] }));
        else toast.error("บันทึกภาพไม่สำเร็จ", { description: r.error });
      }
    });
  };

  const remove = async (id: string) => {
    setV((cur) => ({ ...cur, screenshots: cur.screenshots.filter((s) => s.id !== id) }));
    await removeScreenshot(tradeId, id);
  };

  const setups = v.setup && !tags.setups.includes(v.setup) ? [...tags.setups, v.setup] : tags.setups;

  return (
    <div
      className="flex flex-col gap-5"
      onPaste={(e) => {
        if (e.clipboardData.files.length) {
          e.preventDefault();
          upload(e.clipboardData.files);
        }
      }}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-medium text-fg-2">บันทึก</h3>
        <SaveIndicator state={state} />
      </div>

      <Group label="Setup">
        {setups.map((s) => (
          <Chip key={s} active={v.setup === s} onClick={() => set({ setup: v.setup === s ? null : s }, true)}>
            {s}
          </Chip>
        ))}
      </Group>
      <Group label="Confluences">
        {tags.confluences.map((s) => (
          <Chip key={s} active={v.confluences.includes(s)} onClick={() => set({ confluences: toggle(v.confluences, s) })}>
            {s}
          </Chip>
        ))}
      </Group>
      <Group label="อารมณ์" hint="ตอนเข้าเทรดรู้สึกยังไง">
        {tags.emotions.map((s) => (
          <Chip key={s} tone="violet" active={v.emotions.includes(s)} onClick={() => set({ emotions: toggle(v.emotions, s) }, true)}>
            {s}
          </Chip>
        ))}
      </Group>
      <Group label="ข้อผิดพลาด">
        {tags.mistakes.map((s) => (
          <Chip key={s} tone="red" active={v.mistakes.includes(s)} onClick={() => set({ mistakes: toggle(v.mistakes, s) })}>
            {s}
          </Chip>
        ))}
      </Group>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <span className="text-[12px] font-medium text-fg-2">การ execute</span>
          <div className="flex items-center gap-0.5" role="radiogroup" aria-label="คะแนนการ execute">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={v.rating === n}
                aria-label={`${n} จาก 5`}
                onClick={() => set({ rating: v.rating === n ? null : n })}
                className="grid size-8 place-items-center rounded-[8px] transition-transform hover:scale-110 active:scale-95"
              >
                <Star className={cn("size-5 transition-colors", v.rating !== null && n <= v.rating ? "fill-amber text-amber" : "text-fg-3/50")} />
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-[12px] font-medium text-fg-2">ทำตามแผนไหม?</span>
          <div className="flex gap-1.5">
            <Chip tone="green" active={v.followedPlan === true} onClick={() => set({ followedPlan: v.followedPlan === true ? null : true })}>
              ใช่
            </Chip>
            <Chip tone="red" active={v.followedPlan === false} onClick={() => set({ followedPlan: v.followedPlan === false ? null : false })}>
              ไม่
            </Chip>
          </div>
        </div>
      </div>

      <label className="flex flex-col gap-2">
        <span className="text-[12px] font-medium text-fg-2">โน้ต</span>
        <Textarea value={v.notes} onChange={(e) => set({ notes: e.target.value })} onBlur={flush} placeholder="ทำไมถึงเข้า เห็นอะไร ถ้าย้อนได้จะทำอะไรต่างไป…" rows={4} />
      </label>

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <span className="text-[12px] font-medium text-fg-2">ภาพหน้าจอ</span>
          <span className="text-[11px] text-fg-3">วาง (⌘V) ลากมาวาง หรือเลือกรูป · สูงสุด 8 MB</span>
        </div>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            upload(e.dataTransfer.files);
          }}
          className={cn("grid grid-cols-2 gap-2 rounded-[var(--radius-inner)] p-2 ring-1 ring-inset transition-colors sm:grid-cols-3", drag ? "bg-blue-soft ring-blue" : "bg-surface-2/50 ring-line")}
        >
          <AnimatePresence initial={false}>
            {v.screenshots.map((s) => (
              <motion.figure key={s.id} layout initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.94 }} transition={spring.snappy} className="group relative aspect-video overflow-hidden rounded-[10px] bg-surface-3">
                <a href={`/api/files/${s.id}`} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/files/${s.id}`} alt={s.caption || "ภาพหน้าจอเทรด"} className="size-full object-cover" loading="lazy" />
                </a>
                <button type="button" aria-label="ลบภาพ" onClick={() => remove(s.id)} className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur transition-opacity group-hover:opacity-100 focus-visible:opacity-100">
                  <X className="size-3.5" />
                </button>
              </motion.figure>
            ))}
          </AnimatePresence>
          <button type="button" onClick={() => fileRef.current?.click()} className="flex aspect-video flex-col items-center justify-center gap-1 rounded-[10px] text-[12px] border border-dashed border-line-strong text-fg-3 transition-colors hover:bg-surface-3/60 hover:text-fg">
            {uploading ? <Loader2 className="size-5 animate-spin" /> : <ImagePlus className="size-5" />}
            {uploading ? "กำลังอัปโหลด" : "เพิ่มรูป"}
          </button>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={(e) => e.target.files && upload(e.target.files)} />
        </div>
      </div>
    </div>
  );
}
