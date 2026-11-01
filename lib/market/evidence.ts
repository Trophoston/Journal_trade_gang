import type { Bar, CloseReason, EvidenceItem, Importance, Side, SlChange } from "../domain/types";
import { sessionSpans } from "../time/sessions";
import { addDays, tradingDayBounds, tradingDayOf, weekdayOf } from "../time/zone";
import { atr, ema, findFvgs, indexAt, rangeOf, swings } from "./indicators";

export interface EvidenceInput {
  side: Side;
  entryPrice: number;
  exitPrice?: number | null;
  sl0?: number;
  tp0?: number;
  r?: number | null; // null when the trade had no stop-loss
  openedAt: Date;
  closedAt?: Date;
  closeReason?: CloseReason;
  slHistory?: SlChange[];
  m1?: Bar[];
  m5?: Bar[];
  m15?: Bar[];
  h1?: Bar[];
  news?: { time: Date; currency: string; name: string; importance: Importance }[];
}

export interface EvidenceResult {
  items: EvidenceItem[];
  mae?: { price: number; r?: number };
  mfe?: { price: number; r?: number };
  coverage: string[];
}

const MIN = 60_000;

export function fmtPrice(n: number): string {
  const a = Math.abs(n);
  return n.toFixed(a >= 1000 ? 2 : a >= 10 ? 3 : 5);
}

export function fmtGap(ms: number): string {
  const m = Math.round(Math.abs(ms) / MIN);
  if (m < 60) return `${m} นาที`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} ชม. ${m % 60} นาที` : `${h} ชม.`;
}

interface Level {
  name: string;
  price: number;
  side: "high" | "low";
  named: boolean;
}

export function computeEvidence(x: EvidenceInput): EvidenceResult {
  const items: Omit<EvidenceItem, "id">[] = [];
  const dir = x.side === "long" ? 1 : -1;
  const entryT = x.openedAt.getTime();
  const exitT = x.closedAt?.getTime();
  const riskDist = x.sl0 ? Math.abs(x.entryPrice - x.sl0) : undefined;
  const toR = (dist: number) => (riskDist ? Math.round((dist / riskDist) * 100) / 100 : undefined);
  const coverage = (["m1", "m5", "m15", "h1"] as const).filter((k) => (x[k]?.length ?? 0) > 0).map((k) => k.toUpperCase());

  // ── MAE / MFE ─────────────────────────────────────────
  let mae: EvidenceResult["mae"], mfe: EvidenceResult["mfe"];
  const fine = x.m1?.length ? x.m1 : x.m5;
  if (fine?.length && exitT) {
    const inside = fine.slice(indexAt(fine, entryT - MIN), indexAt(fine, exitT + 1));
    const rg = rangeOf(inside);
    if (rg) {
      // The fills are ground truth: a candle feed that disagrees with them can't hide the exit.
      const realized = typeof x.exitPrice === "number" ? dir * (x.exitPrice - x.entryPrice) : 0;
      const adverse = Math.max(0, -realized, dir > 0 ? x.entryPrice - rg.low : rg.high - x.entryPrice);
      const favor = Math.max(0, realized, dir > 0 ? rg.high - x.entryPrice : x.entryPrice - rg.low);
      mae = { price: adverse, r: toR(adverse) };
      mfe = { price: favor, r: toR(favor) };
      if (mfe.r !== undefined && mae.r !== undefined)
        items.push({
          kind: "excursion",
          polarity: "neutral",
          tf: x.m1?.length ? "M1" : "M5",
          title: `ติดลบสุด ${mae.r.toFixed(2)}R · บวกสุด ${mfe.r.toFixed(2)}R`,
          detail: `ราคาวิ่งสวนไป ${mae.r.toFixed(2)}R และไปได้ดีสุด +${mfe.r.toFixed(2)}R ก่อนออก${typeof x.r === "number" ? `ที่ ${x.r >= 0 ? "+" : ""}${x.r.toFixed(2)}R` : ""}`,
        });
      if ((x.r ?? 0) < 0 && (mfe.r ?? 0) >= 1)
        items.push({
          kind: "excursion",
          polarity: "against",
          title: `เคยบวก +${mfe.r!.toFixed(2)}R ก่อนกลับตัว`,
          detail: "เทรดนี้เคยกำไรชัดเจนแล้วคืนหมด ไม่มี partial หรือกฎ break-even มาช่วยป้องกัน",
        });
    }
  }

  const m5 = x.m5 ?? [];
  const before = m5.slice(Math.max(0, indexAt(m5, entryT) - 60), indexAt(m5, entryT));

  // ── Reference levels: previous day, Asia, London ──────
  const levels: Level[] = [];
  const ctx = (x.m15?.length ? x.m15 : x.h1) ?? [];
  if (ctx.length) {
    const day = tradingDayOf(x.openedAt);
    const prev = tradingDayBounds(addDays(day, weekdayOf(day) === 1 ? -3 : -1));
    const pd = rangeOf(ctx.filter((b) => b.t >= prev.start.getTime() && b.t < prev.end.getTime()));
    if (pd) levels.push({ name: "previous day high", price: pd.high, side: "high", named: true }, { name: "previous day low", price: pd.low, side: "low", named: true });
    for (const s of sessionSpans(day)) {
      if (s.id !== "asia" && s.id !== "london") continue;
      if (s.end.getTime() > entryT) continue;
      const rg = rangeOf(ctx.filter((b) => b.t >= s.start.getTime() && b.t < s.end.getTime()));
      if (rg) levels.push({ name: `${s.label} high`, price: rg.high, side: "high", named: true }, { name: `${s.label} low`, price: rg.low, side: "low", named: true });
    }
  }
  if (before.length > 10) {
    const older = m5.slice(Math.max(0, indexAt(m5, entryT) - 160), indexAt(m5, entryT) - 24);
    for (const s of swings(older, 3).slice(-6))
      levels.push({ name: `swing ${s.kind}`, price: s.price, side: s.kind, named: false });
  }

  // ── Liquidity sweep before entry ──────────────────────
  if (before.length) {
    const recent = before.slice(-36);
    const findSweep = (side: "high" | "low") => {
      let best: { lvl: Level; bar: Bar } | undefined;
      for (const lvl of levels.filter((l) => l.side === side)) {
        for (let i = 0; i < recent.length; i++) {
          const b = recent[i];
          const pierced = side === "low" ? b.l < lvl.price : b.h > lvl.price;
          if (!pierced) continue;
          const back = recent.slice(i, i + 4).some((c) => (side === "low" ? c.c > lvl.price : c.c < lvl.price));
          if (back && (!best || (lvl.named && !best.lvl.named) || (lvl.named === best.lvl.named && b.t > best.bar.t))) best = { lvl, bar: b };
          break;
        }
      }
      return best;
    };
    const withSide = findSweep(dir > 0 ? "low" : "high");
    if (withSide) {
      items.push({
        kind: "sweep",
        polarity: "supports",
        tf: "M5",
        t: withSide.bar.t,
        price: withSide.lvl.price,
        title: `Sweep ${withSide.lvl.name}`,
        detail: `ราคาวิ่ง${dir > 0 ? "ต่ำกว่า" : "สูงกว่า"} ${withSide.lvl.name} (${fmtPrice(withSide.lvl.price)}) แล้วปิดกลับเข้ามา ${fmtGap(entryT - withSide.bar.t)} ก่อนเข้า: เก็บ ${dir > 0 ? "sell-side" : "buy-side"} liquidity ไปในทางที่เป็นประโยชน์กับคุณ`,
      });
      // Market structure shift after the sweep
      const sweepIdx = indexAt(before, withSide.bar.t);
      const pre = swings(before.slice(Math.max(0, sweepIdx - 30), sweepIdx + 1), 2).filter((s) => s.kind === (dir > 0 ? "high" : "low"));
      const pivot = pre.at(-1);
      if (pivot) {
        const broke = before.slice(sweepIdx + 1).find((b) => (dir > 0 ? b.c > pivot.price : b.c < pivot.price));
        if (broke)
          items.push({
            kind: "structure",
            polarity: "supports",
            tf: "M5",
            t: broke.t,
            price: pivot.price,
            title: "Structure shift หลัง sweep",
            detail: `มีแท่งปิด${dir > 0 ? "เหนือ" : "ใต้"} swing ${dir > 0 ? "high" : "low"} ล่าสุด (${fmtPrice(pivot.price)}) หลัง sweep ยืนยันการกลับตัวก่อนเข้า`,
          });
      }
    }
    const against = findSweep(dir > 0 ? "high" : "low");
    if (against && against.lvl.named && entryT - against.bar.t < 90 * MIN)
      items.push({
        kind: "sweep",
        polarity: "against",
        tf: "M5",
        t: against.bar.t,
        price: against.lvl.price,
        title: `เข้าหลัง ${against.lvl.name} โดน sweep`,
        detail: `${dir > 0 ? "Buy" : "Sell"}-side liquidity ที่ ${against.lvl.name} (${fmtPrice(against.lvl.price)}) เพิ่งโดนเก็บ ${fmtGap(entryT - against.bar.t)} ก่อนเข้า มักเป็นสัญญาณกลับตัวสวนทาง ${x.side === "long" ? "Buy" : "Sell"}`,
      });
  }

  // ── Fair value gap at entry ───────────────────────────
  const fvgSource = m5.length ? m5 : x.m15 ?? [];
  if (fvgSource.length) {
    const ei = indexAt(fvgSource, entryT);
    const window = fvgSource.slice(Math.max(0, ei - 48), ei);
    const offset = Math.max(0, ei - 48);
    const want = dir > 0 ? "bull" : "bear";
    const gaps = findFvgs(window)
      .filter((g) => g.dir === want)
      .filter((g) => {
        const pad = (g.top - g.bottom) * 0.35;
        return x.entryPrice >= g.bottom - pad && x.entryPrice <= g.top + pad;
      })
      .filter((g) => !window.slice(g.i + 1).some((b) => (want === "bull" ? b.c < g.bottom : b.c > g.top)));
    const gap = gaps.at(-1);
    if (gap) {
      const tf = m5.length ? "M5" : "M15";
      items.push({
        kind: "fvg",
        polarity: "supports",
        tf,
        t: fvgSource[offset + gap.i - 2]?.t ?? gap.t,
        t2: gap.t,
        price: gap.bottom,
        price2: gap.top,
        title: `Entry ใน ${want === "bull" ? "bullish" : "bearish"} FVG`,
        detail: `Entry ${fmtPrice(x.entryPrice)} อยู่ใน ${tf} fair value gap ที่ยังไม่ถูกเติม ${fmtPrice(gap.bottom)}–${fmtPrice(gap.top)} เกิดขึ้น ${fmtGap(entryT - gap.t)} ก่อนหน้า`,
      });
      if (exitT) {
        const after = fvgSource.slice(ei, indexAt(fvgSource, exitT + 1));
        const failed = after.find((b) => (want === "bull" ? b.c < gap.bottom : b.c > gap.top));
        items.push(
          failed
            ? {
                kind: "fvg",
                polarity: "against",
                tf,
                t: failed.t,
                title: "FVG ไม่ยืน",
                detail: `มีแท่งปิดทะลุอีกฝั่งของ gap ${fmtGap(failed.t - entryT)} หลังเข้า imbalance ไม่ยืน`,
              }
            : { kind: "fvg", polarity: "supports", tf, title: "FVG ยืนได้", detail: "ไม่มีแท่งไหนปิดทะลุ gap ระหว่างที่ถือเทรด" },
        );
      }
    }
  }

  // ── Stop hunt: stopped out, then the move happened ───
  if (exitT && (x.closeReason === "sl" || (x.r ?? 0) <= -0.8) && riskDist) {
    const target = x.tp0 ?? x.entryPrice + dir * riskDist;
    const post = (x.m5 ?? []).slice(indexAt(x.m5 ?? [], exitT), indexAt(x.m5 ?? [], exitT + 6 * 60 * MIN));
    const hit = post.find((b) => (dir > 0 ? b.h >= target : b.l <= target));
    if (hit)
      items.push({
        kind: "stop_hunt",
        polarity: "against",
        tf: "M5",
        t: hit.t,
        price: target,
        title: "โดน SL แล้วราคาไปถึงเป้า",
        detail: `หลังโดน SL ที่ ${fmtPrice(x.exitPrice ?? x.sl0!)} ราคาไปถึง ${x.tp0 ? "TP ของคุณ" : "+1R"} (${fmtPrice(target)}) ใน ${fmtGap(hit.t - exitT)} ต่อมา SL วางอยู่ตรงจุดที่โดนเก็บ liquidity`,
      });
  }

  // ── Break-even too early ──────────────────────────────
  if (riskDist && x.slHistory?.length && Math.abs(x.r ?? 1) < 0.1 && x.closeReason === "sl") {
    const be = x.slHistory.find((h) => Math.abs(h.sl - x.entryPrice) <= riskDist * 0.1);
    if (be)
      items.push({
        kind: "sl_management",
        polarity: "against",
        t: be.time.getTime(),
        title: "เลื่อน SL ไป break-even แล้วโดนกิน",
        detail: `เลื่อน SL ไปที่ entry ${fmtGap(be.time.getTime() - entryT)} หลังเข้า แล้วเทรดปิดที่ break-even`,
      });
  }

  // ── Volatility at entry ───────────────────────────────
  if (m5.length > 120) {
    const a = atr(m5, 14);
    const ei = Math.min(a.length - 1, indexAt(m5, entryT));
    const base = a.slice(Math.max(0, ei - 288), ei).sort((p, q) => p - q);
    const med = base[base.length >> 1];
    if (med && a[ei] / med >= 1.8)
      items.push({
        kind: "volatility",
        polarity: "neutral",
        tf: "M5",
        t: m5[ei]?.t,
        title: `Volatility ${(a[ei] / med).toFixed(1)}× ของปกติ`,
        detail: `M5 ATR ตอนเข้าสูงเป็น ${(a[ei] / med).toFixed(1)} เท่าของค่ากลาง 1 วัน คาดว่าราคาจะแกว่งแรงและมี slippage`,
      });
  }

  // ── Higher-timeframe trend ────────────────────────────
  const h1 = (x.h1 ?? []).filter((b) => b.t < entryT);
  if (h1.length >= 60) {
    const e = ema(h1.map((b) => b.c), 50);
    const last = e.length - 1;
    const slope = e[last] - e[last - 10];
    const trend = h1[last].c > e[last] && slope > 0 ? 1 : h1[last].c < e[last] && slope < 0 ? -1 : 0;
    if (trend)
      items.push({
        kind: "trend",
        polarity: trend === dir ? "supports" : "against",
        tf: "H1",
        title: trend === dir ? "ตามเทรนด์ H1" : "สวนเทรนด์ H1",
        detail: `ตอนเข้า ราคา H1 อยู่${trend > 0 ? "เหนือ 50 EMA ที่ชี้ขึ้น" : "ใต้ 50 EMA ที่ชี้ลง"} เทรด ${x.side === "long" ? "Buy" : "Sell"} นี้จึง${trend === dir ? "ไปตาม" : "สวน"} flow ของ timeframe ใหญ่`,
      });
  }

  // ── News around the trade ─────────────────────────────
  for (const n of (x.news ?? []).filter((n) => n.importance === "high" || n.importance === "medium")) {
    const t = n.time.getTime();
    const near = t >= entryT - 60 * MIN && t <= (exitT ?? entryT) + 15 * MIN;
    if (!near) continue;
    const rel = t < entryT ? `${fmtGap(entryT - t)} ก่อนเข้า` : exitT && t <= exitT ? `${fmtGap(t - entryT)} หลังเข้า (ระหว่างถือ)` : `${fmtGap(t - (exitT ?? entryT))} หลังออก`;
    items.push({
      kind: "news",
      polarity: n.importance === "high" && Math.abs(t - entryT) <= 30 * MIN ? "against" : "neutral",
      t,
      title: `${n.currency} ${n.name}`,
      detail: `ข่าว ${n.currency} ระดับ ${n.importance === "high" ? "High" : "Medium"}-impact ออก ${rel}`,
    });
  }

  return { items: items.map((it, i) => ({ ...it, id: `E${i + 1}` })), mae, mfe, coverage };
}
