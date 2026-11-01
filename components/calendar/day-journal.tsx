"use client";

import { useState } from "react";
import { Field, Textarea } from "@/components/ui/field";
import { SaveIndicator } from "@/components/ui/save-state";
import { Segmented } from "@/components/ui/segmented";
import { saveDay } from "@/lib/actions/journal";
import { useAutosave } from "@/lib/ui/use-autosave";
import { cn } from "@/lib/ui/cn";

type Bias = "bullish" | "bearish" | "neutral";

export function DayJournal({ day, initial }: { day: string; initial: { plan: string; reflection: string; bias: Bias | null; mood: number | null } }) {
  const [plan, setPlan] = useState(initial.plan);
  const [reflection, setReflection] = useState(initial.reflection);
  const [bias, setBias] = useState<Bias | "none">(initial.bias ?? "none");
  const [mood, setMood] = useState<number | null>(initial.mood);
  const { state, queue } = useAutosave((p: Parameters<typeof saveDay>[1]) => saveDay(day, p));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-medium text-fg-2">บันทึกของคุณ</h3>
        <SaveIndicator state={state} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label="Bias"
          size="sm"
          value={bias}
          onChange={(v) => {
            setBias(v);
            queue({ bias: v === "none" ? null : v });
          }}
          options={[
            { value: "none", label: "ไม่มี bias" },
            { value: "bullish", label: "Bullish" },
            { value: "bearish", label: "Bearish" },
            { value: "neutral", label: "Range" },
          ]}
        />
        <div className="flex items-center gap-1" role="radiogroup" aria-label="อารมณ์">
          {[1, 2, 3, 4, 5].map((m) => (
            <button
              key={m}
              role="radio"
              aria-checked={mood === m}
              aria-label={`อารมณ์ ${m} จาก 5`}
              onClick={() => {
                const v = mood === m ? null : m;
                setMood(v);
                queue({ mood: v });
              }}
              className={cn("grid size-8 place-items-center rounded-[10px] text-[15px] transition-transform active:scale-90", mood === m ? "bg-blue-soft ring-1 ring-blue/30" : "opacity-50 hover:opacity-100")}
            >
              {["😣", "😕", "😐", "🙂", "😄"][m - 1]}
            </button>
          ))}
        </div>
      </div>
      <Field label="แผน">
        <Textarea
          value={plan}
          placeholder="Bias, ระดับราคาที่จะจับตา, จะเทรด session ไหน…"
          onChange={(e) => {
            setPlan(e.target.value);
            queue({ plan: e.target.value });
          }}
        />
      </Field>
      <Field label="ทบทวน">
        <Textarea
          value={reflection}
          placeholder="อะไรทำได้ดี พรุ่งนี้จะปรับอะไร…"
          onChange={(e) => {
            setReflection(e.target.value);
            queue({ reflection: e.target.value });
          }}
        />
      </Field>
    </div>
  );
}
