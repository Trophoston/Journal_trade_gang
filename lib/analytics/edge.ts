import { median, stdev, type DayStat, type Summary } from "./metrics";

export interface EdgeTrade {
  r?: number;
  riskMoney?: number;
  mae?: { r?: number };
  mfe?: { r?: number };
  journal?: { followedPlan?: boolean; mistakes?: string[] };
}

export interface EdgeAxis {
  key: "entry" | "exit" | "risk" | "consistency" | "discipline" | "edge";
  label: string;
  score: number | null;
  detail: string;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const lerp = (x: number, lo: number, hi: number) => clamp(((x - lo) / (hi - lo)) * 100);

/** Edge Radar: six 0–100 axes, each with a transparent formula. */
export function edgeRadar(trades: EdgeTrade[], summary: Summary, days: DayStat[], maxDrawdownPct: number) {
  const axes: EdgeAxis[] = [];

  // Heat taken by winning trades: a loser's adverse move is its stop, so it says nothing about entry timing.
  const maes = trades
    .filter((t) => (t.r ?? 0) > 0)
    .map((t) => t.mae?.r)
    .filter((x): x is number => typeof x === "number");
  const medMae = median(maes.map(Math.abs));
  axes.push({
    key: "entry",
    label: "Entry",
    score: maes.length >= 5 && medMae !== null ? clamp(100 * (1 - medMae)) : null,
    detail: medMae !== null && maes.length >= 5 ? `Heat (median) ของเทรดที่ชนะก่อนราคาไปทาง: ${medMae.toFixed(2)}R (0R = 100, 1R = 0)` : "ต้องมีเทรดชนะ 5+ ไม้ที่มีข้อมูลแท่งเทียน",
  });

  const effs = trades
    .filter((t) => (t.r ?? 0) > 0 && (t.mfe?.r ?? 0) > 0)
    .map((t) => Math.min(1, (t.r ?? 0) / (t.mfe!.r as number)));
  const medEff = median(effs);
  axes.push({
    key: "exit",
    label: "Exit",
    score: effs.length >= 5 && medEff !== null ? clamp(medEff * 100) : null,
    detail: medEff !== null && effs.length >= 5 ? `เทรดที่ชนะเก็บได้ ${(medEff * 100).toFixed(0)}% ของระยะที่ดีที่สุด` : "ต้องมีเทรดชนะ 5+ ไม้ที่มีข้อมูลแท่งเทียน",
  });

  const risks = trades.map((t) => t.riskMoney).filter((x): x is number => typeof x === "number" && x > 0);
  const mean = risks.length ? risks.reduce((a, b) => a + b, 0) / risks.length : 0;
  const cv = mean ? stdev(risks) / mean : null;
  const riskParts = [cv !== null && risks.length >= 5 ? clamp(100 * (1 - cv)) : null, clamp(100 * (1 - maxDrawdownPct / 20))].filter(
    (x): x is number => x !== null,
  );
  axes.push({
    key: "risk",
    label: "Risk",
    score: summary.count >= 5 ? Math.round(riskParts.reduce((a, b) => a + b, 0) / riskParts.length) : null,
    detail: `ความแกว่งของขนาด risk ${cv === null ? "n/a" : `${(cv * 100).toFixed(0)}%`} · max drawdown ${maxDrawdownPct.toFixed(1)}%`,
  });

  const traded = days.filter((d) => d.count > 0);
  const green = traded.filter((d) => d.net > 0).length;
  const greenPct = traded.length ? green / traded.length : 0;
  axes.push({
    key: "consistency",
    label: "Consistency",
    score: traded.length >= 5 ? lerp(greenPct * 100, 30, 75) : null,
    detail: `วันเขียว ${green}/${traded.length} วัน`,
  });

  const planned = trades.filter((t) => typeof t.journal?.followedPlan === "boolean");
  const followed = planned.filter((t) => t.journal?.followedPlan).length;
  const tagged = trades.filter((t) => t.journal && (t.journal.mistakes?.length ?? 0) > 0).length;
  axes.push({
    key: "discipline",
    label: "Discipline",
    score: planned.length >= 5 ? clamp((followed / planned.length) * 100 - (tagged / Math.max(1, trades.length)) * 30) : null,
    detail: planned.length ? `ทำตามแผน ${followed}/${planned.length} เทรดที่แท็กไว้` : "แท็กเทรดว่า ‘ทำตามแผน’ เพื่อให้คะแนนส่วนนี้",
  });

  const edgeParts = [
    summary.avgR !== null && summary.rCount >= 5 ? lerp(summary.avgR, -0.2, 0.5) : null,
    summary.profitFactor !== null && Number.isFinite(summary.profitFactor) ? lerp(summary.profitFactor, 0.8, 2.2) : null,
  ].filter((x): x is number => x !== null);
  axes.push({
    key: "edge",
    label: "Edge",
    score: edgeParts.length && summary.count >= 5 ? Math.round(edgeParts.reduce((a, b) => a + b, 0) / edgeParts.length) : null,
    detail: `Avg ${summary.avgR?.toFixed(2) ?? "–"}R · PF ${summary.profitFactor !== null && Number.isFinite(summary.profitFactor) ? summary.profitFactor.toFixed(2) : "–"}`,
  });

  const scored = axes.filter((a) => a.score !== null).map((a) => a.score as number);
  return { axes, score: scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : null };
}
