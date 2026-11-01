import type { AccountRules } from "../domain/types";
import { outcome, summarize, type StatTrade } from "./metrics";

export interface Guardrail {
  level: "stop" | "caution" | "info" | "good";
  title: string;
  detail: string;
}

interface GTrade extends StatTrade {
  closedAt?: Date;
}

/** Consecutive losses immediately before each trade, within its trading day. */
function lossesBefore<T extends GTrade>(trades: T[]) {
  const byDay = new Map<string, T[]>();
  for (const t of trades) (byDay.get(t.tradingDay) ?? byDay.set(t.tradingDay, []).get(t.tradingDay)!).push(t);
  const out = new Map<T, { k: number; nth: number }>();
  for (const list of byDay.values()) {
    list.sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime());
    let k = 0;
    list.forEach((t, i) => {
      out.set(t, { k, nth: i + 1 });
      const o = outcome(t);
      if (o === "loss") k++;
      else if (o === "win") k = 0;
    });
  }
  return out;
}

/** Live, rule-based coaching that needs no AI call. */
export function guardrails(opts: {
  today: GTrade[];
  history: GTrade[];
  rules: AccountRules;
  startBalance: number;
  minN?: number;
}): Guardrail[] {
  const { today, history, rules, startBalance } = opts;
  const minN = opts.minN ?? 8;
  const out: Guardrail[] = [];
  const closedToday = today.filter((t) => t.closedAt).sort((a, b) => a.closedAt!.getTime() - b.closedAt!.getTime());
  const netToday = closedToday.reduce((s, t) => s + t.net, 0);

  let streak = 0;
  for (let i = closedToday.length - 1; i >= 0; i--) {
    const o = outcome(closedToday[i]);
    if (o === "loss") streak++;
    else if (o === "win") break;
  }

  if (rules.dailyLossLimitPct && startBalance > 0) {
    const used = (Math.max(0, -netToday) / startBalance) * 100;
    const ratio = used / rules.dailyLossLimitPct;
    if (ratio >= 1)
      out.push({ level: "stop", title: "ถึง Daily loss limit แล้ว", detail: `วันนี้ติดลบ ${used.toFixed(2)}% (ลิมิต ${rules.dailyLossLimitPct}%) หยุดเทรดวันนี้` });
    else if (ratio >= 0.6)
      out.push({ level: "caution", title: "ใกล้ถึง Daily loss limit", detail: `ใช้ไปแล้ว ${used.toFixed(2)}% จาก ${rules.dailyLossLimitPct}%` });
  }
  if (rules.maxTradesPerDay && today.length >= rules.maxTradesPerDay)
    out.push({ level: "stop", title: "ครบจำนวนเทรดต่อวันแล้ว", detail: `เทรดไปแล้ว ${today.length}/${rules.maxTradesPerDay} ครั้ง` });

  const stats = lossesBefore(history);
  if (streak > 0) {
    const bucket = history.filter((t) => Math.min(stats.get(t)?.k ?? 0, 2) === Math.min(streak, 2));
    const s = summarize(bucket);
    const label = streak >= 2 ? "หลังแพ้ติดกัน 2+ ครั้ง" : "หลังแพ้ 1 ครั้ง";
    if (s.count >= minN && s.winRate !== null) {
      const level = (s.avgR ?? s.expectancy ?? 0) < 0 ? (streak >= 2 ? "stop" : "caution") : "info";
      out.push({
        level,
        title: `แพ้ติดกัน ${streak} ครั้ง`,
        detail: `เทรด${label}ของคุณ: win rate ${(s.winRate * 100).toFixed(0)}%, เฉลี่ย ${s.avgR !== null ? `${s.avgR >= 0 ? "+" : ""}${s.avgR.toFixed(2)}R` : `${s.expectancy}`} (n=${s.count})`,
      });
    } else {
      out.push({ level: "caution", title: `แพ้ติดกัน ${streak} ครั้ง`, detail: "ช้าลงก่อน ข้อมูลยังไม่พอจะตัดสินสถานการณ์นี้" });
    }
  }

  const nth = today.length + 1;
  if (nth >= 3) {
    const bucket = history.filter((t) => (stats.get(t)?.nth ?? 0) >= 3);
    const s = summarize(bucket);
    if (s.count >= minN && (s.avgR ?? s.expectancy ?? 0) < 0)
      out.push({ level: "caution", title: "เทรดที่ 3+ ของวัน", detail: `ที่ผ่านมา win rate ${(((s.winRate ?? 0) * 100) | 0)}%, เฉลี่ย ${s.avgR?.toFixed(2) ?? "–"}R (n=${s.count})` });
  }

  if (!out.length && closedToday.length === 0) out.push({ level: "good", title: "วันใหม่", detail: "ยังไม่มีเทรด รอช่วงเวลาที่คุณเทรดได้ดีที่สุด" });
  return out;
}
