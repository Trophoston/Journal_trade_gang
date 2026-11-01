"use client";

import { Radio } from "lucide-react";
import { useConnected } from "@/components/shell/topbar-client";
import { Badge } from "@/components/ui/chip";
import { Ticker } from "@/components/ui/ticker";
import { fmtMoney, fmtNum } from "@/lib/format";
import { cn } from "@/lib/ui/cn";
import { useStore } from "@/lib/ui/store";

interface Props {
  account: {
    id: string;
    source: "mt5" | "demo";
    balance: number;
    equity: number;
    floating: number;
    lastSeenAt: number;
    positions: { ticket: number; symbol: string; side: string; volume: number; profit: number }[];
    dailyLossLimitPct: number;
    maxTradesPerDay: number;
  };
  today: { trades: number; net: number; startBalance: number };
  currency: string;
  scale: number;
}

export function LiveAccount({ account, today, currency, scale }: Props) {
  const live = useStore((s) => s.live[account.id]);
  const { connected } = useConnected(account.id, account.lastSeenAt);
  const balance = live ? live.balance * scale : account.balance;
  const equity = live ? live.equity * scale : account.equity;
  const floating = live ? live.floating * scale : account.floating;
  const dayPnl = today.net + floating;
  const lossUsed = today.startBalance > 0 ? (Math.max(0, -dayPnl) / today.startBalance) * 100 : 0;
  const limit = account.dailyLossLimitPct;
  const ratio = limit ? Math.min(1, lossUsed / limit) : 0;
  const fmt = (n: number) => fmtMoney(n, currency);

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-[13px] font-medium text-fg-2">
          <Radio className="size-4" /> บัญชีสด
        </span>
        {account.source === "demo" ? <Badge>ข้อมูลตัวอย่าง</Badge> : connected ? <Badge tone="green">● Live</Badge> : <Badge>Offline</Badge>}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-[12px] text-fg-3">Balance</div>
          <Ticker value={balance} format={fmt} className="num block text-[22px] leading-tight font-semibold tracking-tight" />
        </div>
        <div>
          <div className="text-[12px] text-fg-3">Equity</div>
          <Ticker value={equity} format={fmt} className="num block text-[22px] leading-tight font-semibold tracking-tight" />
        </div>
        <div>
          <div className="text-[12px] text-fg-3">Floating (ยังไม่ปิด)</div>
          <span className={cn("num text-[15px] font-medium", floating > 0 ? "text-green-ink" : floating < 0 ? "text-red-ink" : "text-metal-ink")}>
            {floating !== 0 && (floating > 0 ? "▲ " : "▼ ")}
            <Ticker value={floating} format={(n) => fmtMoney(n, currency, { sign: true })} />
          </span>
        </div>
        <div>
          <div className="text-[12px] text-fg-3">วันนี้</div>
          <span className={cn("num text-[15px] font-medium", dayPnl > 0 ? "text-green-ink" : dayPnl < 0 ? "text-red-ink" : "text-metal-ink")}>
            {dayPnl !== 0 && (dayPnl > 0 ? "▲ " : "▼ ")}
            {fmtMoney(dayPnl, currency, { sign: true })}
          </span>
          <span className="ml-1.5 text-[12px] text-fg-3">
            {today.trades}
            {account.maxTradesPerDay ? `/${account.maxTradesPerDay}` : ""} เทรด
          </span>
        </div>
      </div>
      {limit > 0 && (
        <div>
          <div className="mb-1.5 flex items-baseline justify-between text-[12px]">
            <span className="text-fg-3">Daily loss limit (ขาดทุนสูงสุดต่อวัน)</span>
            <span className="num text-fg-2">
              {fmtNum(lossUsed, 2)}% of {limit}%
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-3" role="meter" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={Number(lossUsed.toFixed(2))} aria-label="ใช้ Daily loss limit ไปแล้ว">
            <div className={cn("h-full origin-left rounded-full transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]", ratio >= 1 ? "bg-red" : ratio >= 0.6 ? "bg-amber" : "bg-green")} style={{ transform: `scaleX(${Math.max(0.015, ratio)})` }} />
          </div>
        </div>
      )}
      <div className="mt-auto">
        <div className="mb-1.5 text-[12px] text-fg-3">ออเดอร์ที่เปิดอยู่</div>
        {account.positions.length ? (
          <ul className="space-y-1">
            {account.positions.map((p) => (
              <li key={p.ticket} className="flex items-center gap-2 text-[13px]">
                <span className={cn("rounded-md px-1.5 text-[11px] font-semibold", p.side === "long" ? "bg-green-soft text-green-ink" : "bg-red-soft text-red-ink")}>{p.side === "long" ? "BUY" : "SELL"}</span>
                <span className="font-medium">{p.symbol}</span>
                <span className="num text-fg-3">{p.volume}</span>
                <span className={cn("num ml-auto", p.profit >= 0 ? "text-green-ink" : "text-red-ink")}>{fmtMoney(p.profit, currency, { sign: true })}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-fg-3">ไม่มีออเดอร์ที่เปิดอยู่</p>
        )}
      </div>
    </div>
  );
}
