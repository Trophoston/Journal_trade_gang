"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, Square, Wrench, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { dropRepeatedIdLists } from "@/components/ai/cite";
import { AiOrb } from "@/components/ai/orb";
import { TradeRef } from "@/components/ai/trade-ref";
import { Button } from "@/components/ui/button";
import { getThread, listThreads } from "@/lib/actions/ai";
import { cn } from "@/lib/ui/cn";
import { spring } from "@/lib/ui/motion";
import { useStore } from "@/lib/ui/store";

interface Msg {
  role: "user" | "model";
  text: string;
  tools?: { name: string; summary: string }[];
  error?: string;
}

const SUGGEST: Record<string, string[]> = {
  trade: ["เทรดนี้ดีไหม ถึงแม้จะแพ้?", "เทรดนี้ควรเข้าตรงไหนถึงจะดีกว่า?", "หาเทรดอื่นที่คล้ายเทรดนี้"],
  daily: ["พรุ่งนี้ควรแก้อะไร?", "วันนี้ overtrade ไหม?", "วันนี้อารมณ์มีผลกับการเทรดไหม?"],
  weekly: ["ควรเลิกเทรด session ไหน?", "สรุปเป็นกฎ 3 ข้อที่ทำตามได้", "เทียบกับสัปดาห์ก่อนเป็นยังไง?"],
  brief: ["วันนี้ช่วงไหนดีที่สุดสำหรับฉัน?", "ข่าวไหนที่ควรหลีกเลี่ยง?"],
  general: ["ฉันเทรดได้ดีที่สุดตอนไหน?", "เทรดที่แพ้มีอะไรเหมือนกันบ้าง?", "สรุปผลเดือนนี้ให้หน่อย"],
};

// Trade ids in answers become chips: each is rewritten to a markdown link on a private scheme,
// and the link renderer swaps that for a TradeRef (hover summary, click to open).
const TRADE_SCHEME = "tg-trade:";
const withTradeLinks = (text: string) => {
  const seen = new Set<string>();
  return dropRepeatedIdLists(text).replace(/`?\[?(a\d{4,}-[a-z0-9]+_\d+)\]?`?/g, (_, id: string) => {
    if (seen.has(id)) return "";
    seen.add(id);
    return `[${id}](${TRADE_SCHEME}${id})`;
  });
};
const keepTradeLinks = (url: string) => (url.startsWith(TRADE_SCHEME) ? url : defaultUrlTransform(url));
const MD: Components = {
  a: ({ href, children }) =>
    href?.startsWith(TRADE_SCHEME) ? (
      <TradeRef id={href.slice(TRADE_SCHEME.length)} />
    ) : (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    ),
};

const TOOL_LABEL: Record<string, string> = { getStats: "ดูสถิติของคุณ", listTrades: "ค้นหาเทรด", getTrade: "เปิดดูเทรด", getNews: "เช็กปฏิทินข่าว" };

export function ChatPanel() {
  const chat = useStore((s) => s.chat);
  const close = useStore((s) => s.closeChat);
  const target = chat.open ? chat : null;
  const scopeKey = target?.scopeKey;
  const openThreadId = target?.threadId;
  const [messages, setMessages] = useState<Msg[]>([]);
  const [threadId, setThreadId] = useState<string | undefined>();
  const [threads, setThreads] = useState<{ id: string; title: string; updatedAt: string }[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // New scope → fresh conversation + list of earlier threads for it
  useEffect(() => {
    if (!scopeKey) return;
    let live = true;
    setMessages([]);
    setThreadId(undefined);
    listThreads(scopeKey).then((t) => live && setThreads(t));
    if (openThreadId)
      getThread(openThreadId).then((t) => {
        if (!live || !t) return;
        setThreadId(t._id);
        setMessages(t.messages.map((m) => ({ role: m.role, text: m.text, tools: m.tools?.map((x) => ({ name: x.name, summary: x.summary })) })));
      });
    setTimeout(() => inputRef.current?.focus(), 250);
    return () => {
      live = false;
    };
  }, [scopeKey, openThreadId]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [target, busy, close]);

  const openThread = async (id: string) => {
    const t = await getThread(id);
    if (!t) return;
    setThreadId(t._id);
    setMessages(t.messages.map((m) => ({ role: m.role, text: m.text, tools: m.tools?.map((x) => ({ name: x.name, summary: x.summary })) })));
  };

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy || !target) return;
    setInput("");
    setBusy(true);
    setMessages((m) => [...m, { role: "user", text: message }, { role: "model", text: "" }]);
    const ctrl = new AbortController();
    abort.current = ctrl;
    const patchLast = (fn: (m: Msg) => Msg) => setMessages((all) => [...all.slice(0, -1), fn(all[all.length - 1])]);
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId, scopeKey: target.scopeKey, reportId: target.reportId, message }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error("บริการแชตไม่ตอบกลับ");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          if (ev.type === "thread") setThreadId(ev.id);
          else if (ev.type === "text") patchLast((m) => ({ ...m, text: m.text + ev.delta }));
          else if (ev.type === "tool") patchLast((m) => ({ ...m, tools: [...(m.tools ?? []), { name: ev.name, summary: ev.summary }] }));
          else if (ev.type === "error") patchLast((m) => ({ ...m, error: ev.message }));
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") patchLast((m) => ({ ...m, error: (err as Error).message }));
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  const kind = scopeKey?.split(":")[0] ?? "general";
  const suggestions = SUGGEST[kind] ?? SUGGEST.general;

  return (
    <AnimatePresence>
      {target && (
        <motion.aside
          key="chat"
          role="dialog"
          aria-label="แชต AI"
          initial={{ opacity: 0, x: 28, scale: 0.985 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 28, scale: 0.985 }}
          transition={spring.smooth}
          className="glass-chrome fixed inset-2 z-50 flex flex-col overflow-hidden rounded-[24px] sm:inset-auto sm:top-3 sm:right-3 sm:bottom-3 sm:w-[440px]"
        >
          <div className="ai-wash relative z-[2] flex items-center gap-3 border-b border-line px-4 py-3">
            <AiOrb size={26} busy={busy} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{target.title}</div>
              <div className="text-[11px] text-fg-3">Gemini · อ่าน journal ของคุณ ไม่ใช่อินเทอร์เน็ต</div>
            </div>
            <Button variant="ghost" size="icon-sm" aria-label="ปิดแชต" onClick={close}>
              <X />
            </Button>
          </div>

          <div ref={scroller} className="relative z-[2] flex-1 overflow-y-auto overscroll-contain px-4 py-4">
            {messages.length === 0 ? (
              <div className="flex flex-col gap-4">
                <p className="text-[13px] text-fg-2">Ask anything about this {kind === "general" ? "journal" : kind}. The coach can look up your stats, trades and the economic calendar.</p>
                <div className="flex flex-col gap-2">
                  {(target.prompt ? [target.prompt, ...suggestions] : suggestions).map((s) => (
                    <button key={s} onClick={() => send(s)} className="rounded-[14px] bg-surface-2/80 px-3.5 py-2.5 text-left text-[13px] text-fg-2 ring-1 ring-line ring-inset transition-colors hover:bg-violet-soft hover:text-violet-ink">
                      {s}
                    </button>
                  ))}
                </div>
                {threads.length > 0 && (
                  <div>
                    <div className="mb-2 text-[11px] font-semibold tracking-wide text-fg-3 uppercase">แชตก่อนหน้า</div>
                    <div className="flex flex-col gap-1">
                      {threads.map((t) => (
                        <button key={t.id} onClick={() => openThread(t.id)} className="truncate rounded-[10px] px-2.5 py-2 text-left text-[13px] text-fg-2 hover:bg-surface-3">
                          {t.title}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {messages.map((m, i) =>
                  m.role === "user" ? (
                    <div key={i} className="ml-10 self-end rounded-[18px] rounded-br-[6px] bg-blue px-3.5 py-2.5 text-[14px] leading-relaxed text-white">
                      {m.text}
                    </div>
                  ) : (
                    <div key={i} className="mr-4 flex flex-col gap-2">
                      {m.tools && m.tools.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {m.tools.map((t, k) => (
                            <span key={k} className="inline-flex items-center gap-1 rounded-full bg-violet-soft px-2 py-0.5 text-[11px] text-violet-ink">
                              <Wrench className="size-3" />
                              {TOOL_LABEL[t.name] ?? t.name} · {t.summary}
                            </span>
                          ))}
                        </div>
                      )}
                      {m.text ? (
                        <div className="prose-ai text-[14px] text-fg-2">
                          <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD} urlTransform={keepTradeLinks}>{withTradeLinks(m.text)}</ReactMarkdown>
                        </div>
                      ) : !m.error ? (
                        <div className="flex items-center gap-1.5 py-1" aria-label="กำลังคิด">
                          {[0, 1, 2].map((d) => (
                            <span key={d} className="size-1.5 rounded-full bg-violet" style={{ animation: `pulse-ring 1.2s ${d * 0.15}s ease-in-out infinite` }} />
                          ))}
                        </div>
                      ) : null}
                      {m.error && <p className="rounded-[12px] bg-red-soft px-3 py-2 text-[13px] text-red-ink">{m.error}</p>}
                    </div>
                  ),
                )}
              </div>
            )}
          </div>

          <form
            className="relative z-[2] border-t border-line p-3"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <div className="flex items-end gap-2 rounded-[18px] bg-surface-2 p-1.5 ring-1 ring-line-strong ring-inset focus-within:ring-2 focus-within:ring-violet">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    send(input);
                  }
                }}
                rows={1}
                placeholder="ถามโค้ชได้เลย…"
                className="max-h-36 min-h-9 flex-1 resize-none bg-transparent px-2.5 py-2 text-[14px] outline-none placeholder:text-fg-3"
              />
              {busy ? (
                <Button size="icon-sm" variant="soft" aria-label="หยุด" onClick={() => abort.current?.abort()}>
                  <Square className="!size-3 fill-current" />
                </Button>
              ) : (
                <Button type="submit" size="icon-sm" variant="ai" aria-label="ส่ง" disabled={!input.trim()} className={cn(!input.trim() && "opacity-40")}>
                  <ArrowUp />
                </Button>
              )}
            </div>
          </form>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
