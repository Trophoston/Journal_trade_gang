import type { Brief, DailyReview, Driver, PreTrade, TradeAnalysis, WeeklyReview } from "./schemas";

/**
 * Deterministic stand-ins used when AI_PROVIDER=mock, so the whole flow
 * (queue → progress → report → UI) works without a Gemini key.
 */

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Lang = "th" | "en";

const t = (lang: Lang, th: string, en: string) => (lang === "th" ? th : en);

export function mockTrade(ctx: Json, lang: Lang): TradeAnalysis {
  const ev: Json[] = ctx.evidence ?? [];
  const trade = ctx.trade ?? {};
  const win = trade.outcome === "win";
  const find = (kind: string, pol?: string) => ev.find((e) => e.kind === kind && (!pol || e.polarity === pol));
  let primary: { type: Driver; e?: Json } = { type: "random_variance" };
  if (!win && find("stop_hunt")) primary = { type: "stop_hunt", e: find("stop_hunt") };
  else if (!win && find("fvg", "against")) primary = { type: "fvg_failed", e: find("fvg", "against") };
  else if (find("news", "against")) primary = { type: "news_volatility", e: find("news", "against") };
  else if (win && find("sweep", "supports")) primary = { type: "liquidity_sweep", e: find("sweep", "supports") };
  else if (win && find("fvg", "supports")) primary = { type: "fvg_respected", e: find("fvg", "supports") };
  else if (!win && find("trend", "against")) primary = { type: "counter_trend", e: find("trend", "against") };
  else if (!win && find("excursion", "against")) primary = { type: "early_exit", e: find("excursion", "against") };
  const ids = primary.e ? [primary.e.id] : [];
  const reasonTh: Record<string, string> = {
    stop_hunt: "stop loss ถูกกวาดก่อนราคาจะวิ่งไปทางที่คุณคิด",
    fvg_failed: "FVG ที่ใช้เข้าไม่ถูกเคารพ ราคาปิดทะลุโซน",
    news_volatility: "ข่าวแรงช่วงเข้าออร์เดอร์ทำให้ราคาสวิงผิดปกติ",
    liquidity_sweep: "เข้าหลัง liquidity sweep ตามแผน ราคาจึงไปต่อได้ดี",
    fvg_respected: "ราคาเคารพ FVG ที่ใช้เข้า",
    counter_trend: "เทรดสวน trend ของ H1",
    early_exit: "เคยกำไรเกิน 1R แต่ไม่มีแผนล็อกกำไร",
    random_variance: "หลักฐานจากกราฟยังไม่ชัด ผลลัพธ์นี้อยู่ในความผันผวนปกติ",
  };
  const reasonEn: Record<string, string> = {
    stop_hunt: "the stop was swept before price moved your way",
    fvg_failed: "the entry FVG did not hold and price closed through it",
    news_volatility: "high-impact news hit right around the entry",
    liquidity_sweep: "the entry followed a clean liquidity sweep",
    fvg_respected: "price respected the entry FVG",
    counter_trend: "the trade went against the H1 trend",
    early_exit: "it was above 1R with no plan to protect profit",
    random_variance: "the chart evidence is thin; this looks like normal variance",
  };
  const why = lang === "th" ? reasonTh[primary.type] : reasonEn[primary.type];
  return {
    headline: t(lang, `${win ? "ชนะ" : "แพ้"}เพราะ${why}`, `${win ? "Won" : "Lost"} because ${why}`),
    verdict: win ? (trade.followedPlan === false ? "lucky_win" : "good_win") : trade.mistakes?.length ? "bad_loss" : "good_loss",
    primaryDriver: {
      type: primary.type,
      confidence: primary.e ? "medium" : "low",
      explanation: primary.e ? `${primary.e.detail} [${primary.e.id}]` : t(lang, "ยังไม่มีข้อมูลแท่งเทียนพอที่จะยืนยัน", "Not enough candle data to confirm a cause."),
      evidenceIds: ids,
    },
    secondaryDrivers: ev
      .filter((e) => e.id !== primary.e?.id && e.polarity !== "neutral")
      .slice(0, 2)
      .map((e) => ({
        type: (e.kind === "sweep" ? "liquidity_sweep" : e.kind === "trend" ? (e.polarity === "supports" ? "trend_alignment" : "counter_trend") : "other") as Driver,
        confidence: "low" as const,
        explanation: `${e.title} [${e.id}]`,
        evidenceIds: [e.id],
      })),
    wentWell: [t(lang, "มี stop loss ตั้งแต่เข้าออร์เดอร์", "Stop loss was set from the start")],
    toImprove: [t(lang, "รอให้แท่งยืนยันปิดก่อนเข้า", "Wait for the confirming candle to close before entry")],
    scores: { entry: win ? 7 : 5, exit: win ? 6 : 4, risk: 7, discipline: trade.mistakes?.length ? 4 : 7 },
    lesson: t(lang, "เข้าเฉพาะหลัง sweep + structure shift ใน killzone เท่านั้น", "Only enter after a sweep plus a structure shift inside a killzone."),
    ruleSuggestion: t(lang, "ถ้าราคาไปถึง +1R ให้เลื่อน SL ไปที่ -0.5R", "At +1R, move the stop to −0.5R."),
    dataGaps: ev.length ? [] : [t(lang, "ยังไม่มีแท่งเทียนจาก MT5", "No candles from MT5 yet")],
  };
}

export function mockDaily(ctx: Json, lang: Lang): DailyReview {
  const s = ctx.summary ?? {};
  const trades: Json[] = ctx.trades ?? [];
  const best = [...trades].sort((a, b) => (b.r ?? b.net) - (a.r ?? a.net))[0];
  const worst = [...trades].sort((a, b) => (a.r ?? a.net) - (b.r ?? b.net))[0];
  return {
    headline: t(lang, `${s.trades} เทรด · ${s.net >= 0 ? "บวก" : "ลบ"} ${Math.abs(s.net)} · win rate ${s.winRate ?? "–"}%`, `${s.trades} trades · net ${s.net} · win rate ${s.winRate ?? "–"}%`),
    summary: t(lang, "วันนี้เทรดตามแผนส่วนใหญ่ แต่ออร์เดอร์หลังแพ้ติดกันเริ่มรีบเกินไป", "Mostly on plan today, but trades after back-to-back losses got rushed."),
    score: Math.max(30, Math.min(90, 60 + Math.round((s.avgR ?? 0) * 20))),
    bestTradeId: best?.id ?? "",
    bestTradeWhy: best ? t(lang, "เข้าในช่วง killzone หลัง sweep", "Entered in the killzone after a sweep") : "",
    worstTradeId: worst && worst !== best ? worst.id : "",
    worstTradeWhy: worst && worst !== best ? t(lang, "เข้าก่อนแท่งยืนยัน", "Entered before confirmation") : "",
    wentWell: [t(lang, "ทุกเทรดมี stop loss", "Every trade had a stop loss")],
    toImprove: [t(lang, "พักอย่างน้อย 30 นาทีหลังแพ้", "Take a 30-minute break after a loss")],
    ruleBreaks: ctx.detectedRuleBreaks ?? [],
    emotionalNote: t(lang, "สังเกต FOMO ช่วงท้าย session", "Some FOMO late in the session"),
    keyLesson: t(lang, "คุณภาพสำคัญกว่าจำนวนเทรด", "Quality over quantity."),
    tomorrowFocus: [t(lang, "เทรดเฉพาะ London KZ และ NY AM", "Trade only London KZ and NY AM"), t(lang, "สูงสุด 2 เทรด", "Max 2 trades")],
  };
}

export function mockWeekly(ctx: Json, lang: Lang): WeeklyReview {
  const stats: Json[] = ctx.stats ?? [];
  const sessions = stats.filter((x) => String(x.group).includes("90 days by session")).sort((a, b) => (b.avgR ?? 0) - (a.avgR ?? 0));
  const best = sessions[0];
  const worst = sessions.at(-1);
  return {
    headline: t(lang, `สัปดาห์นี้ ${ctx.summary?.trades ?? 0} เทรด · net ${ctx.summary?.net ?? 0}`, `${ctx.summary?.trades ?? 0} trades this week · net ${ctx.summary?.net ?? 0}`),
    summary: t(lang, "edge หลักยังอยู่ที่ setup sweep + FVG ช่วง killzone ส่วนเทรดนอกช่วงเวลาหลักกินกำไรคืน", "Your edge is still sweep + FVG inside killzones; trades outside your main windows gave profit back."),
    score: 64,
    strengths: best ? [{ title: t(lang, `${best.key} คือช่วงที่ดีที่สุด`, `${best.key} is your best window`), detail: `n=${best.n}, ${best.winRate}% , ${best.avgR}R`, evidence: best.id }] : [],
    weaknesses: worst && worst !== best ? [{ title: t(lang, `${worst.key} ยังติดลบ`, `${worst.key} is still negative`), detail: `n=${worst.n}, ${worst.avgR}R`, evidence: worst.id }] : [],
    strongTimes: best ? [{ window: best.key, stat: `${best.winRate}% · ${best.avgR}R · n=${best.n}`, comment: t(lang, "เพิ่มน้ำหนักช่วงนี้", "Focus here") }] : [],
    weakTimes: worst && worst !== best ? [{ window: worst.key, stat: `${worst.winRate}% · ${worst.avgR}R · n=${worst.n}`, comment: t(lang, "หลีกเลี่ยงหรือลดขนาด", "Avoid or size down") }] : [],
    setups: [],
    mistakesCost: (ctx.mistakesCost ?? []).slice(0, 3).map((m: Json) => ({ mistake: m.mistake, cost: String(m.net), comment: `n=${m.n}` })),
    behavior: [t(lang, "เทรดถี่ขึ้นหลังวันที่ขาดทุน", "Trading more often after red days")],
    lastWeekPlanCheck: (ctx.lastWeekRules ?? []).length ? t(lang, "ทำตามกฎได้บางส่วน", "Rules partly followed") : t(lang, "ยังไม่มีกฎจากสัปดาห์ก่อน", "No rules from last week yet"),
    nextWeekRules: [t(lang, "เทรดเฉพาะช่วงที่สถิติเป็นบวก", "Only trade your positive windows"), t(lang, "หยุดหลังแพ้ 2 ครั้งติด", "Stop after 2 losses in a row")],
    focus: t(lang, "คัดเฉพาะ A+ setup", "Only A+ setups"),
  };
}

export function mockBrief(ctx: Json, lang: Lang): Brief {
  const g: Json[] = ctx.guardrails ?? [];
  const stop = g.some((x) => x.level === "stop");
  const caution = g.some((x) => x.level === "caution");
  const sessions: Json[] = (ctx.stats ?? []).filter((s: Json) => (s.avgR ?? 0) > 0).sort((a: Json, b: Json) => b.avgR - a.avgR);
  const spans: Json[] = ctx.sessionsToday ?? [];
  return {
    stance: stop ? "stop" : caution ? "caution" : "go",
    headline: stop ? t(lang, "วันนี้พอแล้ว ตามกฎ", "Done for today, by your rules") : t(lang, "รอ setup ใน killzone ที่คุณถนัด", "Wait for your setup inside your best killzone"),
    reasons: g.map((x) => `${x.title}: ${x.detail}`).slice(0, 3),
    bestWindows: sessions.slice(0, 2).map((s) => ({
      window: s.key,
      localTime: spans.find((sp) => sp.session === s.key)?.killzone ?? spans.find((sp) => sp.session === s.key)?.local ?? "",
      why: `n=${s.n} · ${s.winRate}% · ${s.avgR}R`,
    })),
    newsWatch: (ctx.news ?? []).filter((n: Json) => n.importance === "high").slice(0, 3).map((n: Json) => ({ time: n.local, event: `${n.currency} ${n.name}`, advice: t(lang, "ไม่เปิดออร์เดอร์ใหม่ 15 นาทีก่อน-หลัง", "No new entries 15 min before/after") })),
    checklist: [t(lang, "HTF bias ตรงกัน", "HTF bias agrees"), t(lang, "มี sweep ก่อนเข้า", "Liquidity swept first"), t(lang, "ความเสี่ยง 1%", "Risk 1%")],
    avoid: [t(lang, "เทรดล้างแค้นหลังแพ้", "Revenge trades after a loss")],
  };
}

export function mockPreTrade(ctx: Json, lang: Lang): PreTrade {
  const rows: Json[] = ctx.stats ?? [];
  const main = rows.find((r) => r.n >= (ctx.minSample ?? 8));
  const good = main && (main.avgR ?? 0) > 0.2;
  const stop = (ctx.guardrails ?? []).some((g: Json) => g.level === "stop");
  return {
    fit: stop ? "skip" : good ? "A+" : main ? "C" : "B",
    headline: stop ? t(lang, "ข้าม: ชนลิมิตของวันแล้ว", "Skip: daily limit reached") : good ? t(lang, "ตรงกับเงื่อนไขที่คุณทำกำไรได้", "Matches your profitable conditions") : t(lang, "ข้อมูลยังไม่พอ ลดขนาด", "Not enough data, size down"),
    historicalMatch: main ? `${main.key}: n=${main.n}, ${main.winRate}%, ${main.avgR}R [${main.id}]` : t(lang, "ยังไม่มีประวัติที่ตรงกันพอ", "No matching history yet"),
    reasons: rows.slice(0, 2).map((r) => `${r.key}: n=${r.n}, ${r.avgR ?? "–"}R [${r.id}]`),
    risks: (ctx.news ?? []).slice(0, 2).map((n: Json) => `${n.local} ${n.currency} ${n.name}`),
    adjustments: [t(lang, "ใช้ stop เลย sweep wick", "Place the stop beyond the sweep wick")],
  };
}
