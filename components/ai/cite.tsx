"use client";

import { createContext, useContext } from "react";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/ui/cn";
import { TradeRef } from "./trade-ref";

export type CiteMap = Record<string, { title: string; detail?: string }>;
export const CiteContext = createContext<CiteMap>({});

/** Emits a "show this on the chart" event; the candle chart listens for it. */
export function focusEvidence(id: string) {
  window.dispatchEvent(new CustomEvent("tg:evidence", { detail: id }));
}

export function CiteChip({ id }: { id: string }) {
  const map = useContext(CiteContext);
  const item = map[id];
  const chip = (
    <button
      type="button"
      onClick={() => id.startsWith("E") && focusEvidence(id)}
      className={cn(
        "mx-0.5 inline-flex h-[18px] translate-y-[-1px] items-center rounded-[6px] px-1.5 align-middle font-mono text-[10.5px] font-semibold ring-1 ring-inset transition-colors",
        id.startsWith("E") ? "bg-blue-soft text-blue-ink ring-blue/20 hover:bg-blue hover:text-white" : id.startsWith("N") ? "bg-[color-mix(in_oklab,var(--amber)_15%,transparent)] text-fg-2 ring-line" : "bg-metal-soft text-fg-2 ring-line",
      )}
    >
      {id}
    </button>
  );
  if (!item) return chip;
  return (
    <Tip content={<span><span className="font-medium text-fg">{item.title}</span>{item.detail && <span className="mt-0.5 block">{item.detail}</span>}</span>}>
      {chip}
    </Tip>
  );
}

const TOKEN = /\[?\b([ENS]\d{1,2})\b\]?|\[?(a\d{4,}-[a-z0-9]+_\d+)\]?/g;
const ID_LIST = /a\d{4,}-[a-z0-9]+_\d+(?:\s*,\s*a\d{4,}-[a-z0-9]+_\d+)+/g;

/** Drops comma-separated lists of trade ids that only repeat trades already named earlier in the text. */
export function dropRepeatedIdLists(text: string) {
  return text.replace(ID_LIST, (list, at: number) => {
    const before = text.slice(0, at);
    return list.split(/\s*,\s*/).every((id) => before.includes(id)) ? "" : list;
  });
}

/**
 * Renders AI text with evidence ids (E2, N1, S3) and trade ids as interactive chips.
 * The AI often repeats trades it already named as a bare id list at the end; that list is dropped.
 */
export function Cite({ text, className }: { text: string; className?: string }) {
  const seen = new Set<string>();
  const cleaned = dropRepeatedIdLists(text);
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of cleaned.matchAll(TOKEN)) {
    out.push(cleaned.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1]) out.push(<CiteChip key={m.index} id={m[1]} />);
    else if (!seen.has(m[2])) {
      seen.add(m[2]);
      out.push(<TradeRef key={m.index} id={m[2]} />);
    }
  }
  out.push(cleaned.slice(last).replace(/^\s+([.,])/, "$1"));
  return <span className={className}>{out}</span>;
}
