const ALIASES: Record<string, string> = {
  GOLD: "XAUUSD",
  SILVER: "XAGUSD",
  USTEC: "NAS100",
  NDX100: "NAS100",
  US100: "NAS100",
  NQ100: "NAS100",
  DJ30: "US30",
  US500: "SPX500",
  SPX: "SPX500",
  USOIL: "WTI",
  XTIUSD: "WTI",
};

/**
 * Canonical symbol used for grouping and news lookup. Explicit mappings win.
 * Strips broker suffixes: Exness "XAUUSDm"/"XAUUSDc", "EURUSD.r", "GOLD#", "US30_i".
 */
export function canonicalSymbol(raw: string, map: Record<string, string> = {}): string {
  if (map[raw]) return map[raw];
  const base = raw
    .replace(/(\.[^.]*|[#!_\-+].*)$/, "")
    .replace(/[a-z]+$/, "")
    .toUpperCase();
  return ALIASES[base] ?? base;
}

const CURRENCIES = ["USD", "EUR", "GBP", "JPY", "AUD", "NZD", "CAD", "CHF", "CNH", "CNY"];

/** Currencies whose economic news moves a symbol. */
export function newsCurrencies(symbol: string): string[] {
  if (/^XA[UG]/.test(symbol)) return ["USD"];
  if (/^(NAS100|US30|SPX500|WTI|BTCUSD)$/.test(symbol)) return ["USD"];
  const a = symbol.slice(0, 3);
  const b = symbol.slice(3, 6);
  const out = [a, b].filter((c) => CURRENCIES.includes(c));
  return out.length ? out : ["USD"];
}

/** Default pip size: 10 points for 3/5-digit FX, 0.1 for gold, otherwise one point. */
export function defaultPipSize(symbol: string, digits: number, point: number): number {
  if (/^XAU/.test(symbol)) return 0.1;
  if (digits === 3 || digits === 5) return point * 10;
  return point;
}
