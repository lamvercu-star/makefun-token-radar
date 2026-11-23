// The token radar's model, radar-2: the snapshot prices itself.
// 
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds
// pre-token protocols below the watchlist floor: the early rows the radar exists to find. A protocol
// is pre-token when its index entry records no token (no market cap, no CoinGecko id, no symbol);
// the snapshot's live-token protocols are kept apart and shown as the market's own values, never
// mixed into the ranked board. Wrapped, staked and bridged products of a token that already trades
// are never ranked: they are not a launch that has not happened yet.
//
// Implied value follows only from the snapshot's own figures, fitted at run time from the
// protocols in the same snapshot whose token already trades:
//
//   comps      = traded protocols (mcap > 0, gecko_id and symbol set, TVL > 0, not a CEX)
//   log-log    = OLS fit of log(mcap) on log(tvl) over the comps: mcap ~ exp(a) * tvl^b
//   catMult    = median mcap/tvl of the comps in the protocol's category, shrunk (k = 8) in
//                log space toward the log-log curve's multiple at this protocol's TVL
//   base       = tvl_usd * catMult
//   growth     = clamp(change_7d, -60, 120) per cent
//   growthMult = 1 + (growth / 100) * 0.20
//   maturity   = 0.85 + min(age_days, 1095) / 1095 * 0.30   (age unknown: 365 days)
//   implied    = max(1, round(base * growthMult * maturity))
//
// No protocol name is ever special-cased: the same function scores every row, and the fit is
// recomputed from whatever snapshot is passed in. The dashboard states the fit (intercept, slope,
// R2, leave-one-out error) so a reader can check it. A leave-one-out backtest over the comps
// measures the model: each traded protocol is priced with a fit that never saw it, and the median
// absolute log error is reported as a factor (implied low/high band = implied / factor .. * factor).
// On this snapshot the log-log fit beats a flat median multiple (median |log error| 1.22 vs 1.58),
// which is why the board uses the curve, not one multiple for every protocol.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  shrinkage_k: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  shrinkage_k: 8,
  growth_weight: 0.2,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.85,
  maturity_range: 0.3,
  maturity_days: 1095,
  unknown_age_days: 365,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  verdict: 'Farm' | 'Thin' | 'Skip';
  model: {
    category_multiple: number;
    category_n: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
    implied_low_usd: number;
    implied_high_usd: number;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  verdict: 'Farm' | 'Thin' | 'Skip';
  category_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One category's fitted multiple, for the dashboard's calibration table. */
export interface CategoryMultiple {
  category: string;
  n: number;
  median_multiple: number;
}

/** The fit the snapshot's own traded protocols give, reported whole in the dashboard. */
export interface Calibration {
  n_comps: number;
  intercept: number;
  slope: number;
  r2: number;
  global_median_multiple: number;
  loo_median_log_error: number;
  loo_factor: number;
  flat_median_log_error: number;
  categories: CategoryMultiple[];
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  calibration: Calibration;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A whole word wrapped, staked or staking anywhere in a name. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** Categories that are a wrapped, staked or bridged product, not a launch of their own. */
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);
/** An exchange's name at the start of a protocol name. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is a wrapped, staked or bridged product of a token that already trades. */
export function isWrappedProduct(p: SnapshotProtocol): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  if (EXCHANGE_PREFIX.test(p.name)) return true;
  if (VERSIONED.test(p.name)) return true;
  return false;
}

/** Whether a protocol is one the board may rank: pre-token, and not a wrapped/staked product. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !isWrappedProduct(p);
}

/** Whether a protocol can price the model: its token trades, so its market cap is a fact. */
export function isComp(p: SnapshotProtocol): boolean {
  return (
    p.mcap_usd !== null &&
    p.mcap_usd > 0 &&
    p.gecko_id !== null &&
    p.symbol !== null &&
    p.tvl_usd > 0 &&
    p.category !== 'CEX'
  );
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** OLS fit of log(mcap) on log(tvl) over the comps. */
export function fitLogLog(comps: SnapshotProtocol[]): { intercept: number; slope: number; r2: number } {
  const xs = comps.map((p) => Math.log(p.tvl_usd));
  const ys = comps.map((p) => Math.log(p.mcap_usd!));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let sxy = 0;
  let sxx = 0;
  let sst = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) * (xs[i]! - mx);
    sst += (ys[i]! - my) * (ys[i]! - my);
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  let sse = 0;
  for (let i = 0; i < xs.length; i++) sse += (ys[i]! - (intercept + slope * xs[i]!)) ** 2;
  return { intercept, slope, r2: sst === 0 ? 0 : 1 - sse / sst };
}

/** The log-log curve's multiple (mcap/tvl) at a TVL. */
function curveMultiple(tvl: number, fit: { intercept: number; slope: number }): number {
  return Math.exp(fit.intercept) * Math.pow(tvl, fit.slope - 1);
}

/**
 * One protocol's multiple: its category's median mcap/tvl among the traded comps, shrunk in log
 * space toward the log-log curve at this TVL (weight n / (n + k)); the curve alone when the
 * category has fewer than 4 comps. Returns the multiple and the category's comp count.
 */
export function categoryMultiple(
  category: string | null,
  tvl: number,
  fit: { intercept: number; slope: number },
  catMedians: Map<string, { median: number; n: number }>,
  k: number,
): { multiple: number; n: number } {
  const curve = curveMultiple(tvl, fit);
  const entry = category === null ? undefined : catMedians.get(category);
  if (entry === undefined || entry.n < 4) return { multiple: curve, n: entry?.n ?? 0 };
  const w = entry.n / (entry.n + k);
  const blended = Math.exp(w * Math.log(entry.median) + (1 - w) * Math.log(curve));
  return { multiple: blended, n: entry.n };
}

/** The three multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  fit: { intercept: number; slope: number },
  catMedians: Map<string, { median: number; n: number }>,
  looFactor: number,
): {
  implied: number;
  multiple: number;
  categoryN: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  age: number | null;
  low: number;
  high: number;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const { multiple, n } = categoryMultiple(protocol.category, protocol.tvl_usd, fit, catMedians, model.shrinkage_k);
  const base = protocol.tvl_usd * multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
  return {
    implied,
    multiple,
    categoryN: n,
    growthPct,
    growthMult,
    maturityMult,
    age,
    low: Math.max(1, Math.round(implied / looFactor)),
    high: Math.round(implied * looFactor),
  };
}

/** Leave-one-out backtest of the log-log curve over the comps: median absolute log error. */
export function looLogError(comps: SnapshotProtocol[]): number {
  const errs: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const rest = comps.filter((_, j) => j !== i);
    const fit = fitLogLog(rest);
    const p = comps[i]!;
    errs.push(Math.abs(Math.log(p.mcap_usd!) - (fit.intercept + fit.slope * Math.log(p.tvl_usd))));
  }
  return median(errs);
}

/** Median absolute log error of one flat multiple over the comps (the starter's kind of model). */
export function flatLogError(comps: SnapshotProtocol[], multiple: number): number {
  return median(comps.map((p) => Math.abs(Math.log(p.mcap_usd!) - Math.log(p.tvl_usd * multiple))));
}

/** The full calibration of the snapshot: fit, category medians and the backtest, all from the snapshot. */
export function calibrate(snapshot: Snapshot, model: ModelConstants = MODEL): Calibration {
  const comps = snapshot.protocols.filter(isComp);
  const fit = fitLogLog(comps);
  const byCat = new Map<string, number[]>();
  for (const p of comps) {
    const key = p.category ?? 'Other';
    const arr = byCat.get(key) ?? [];
    arr.push(p.mcap_usd! / p.tvl_usd);
    byCat.set(key, arr);
  }
  const categories: CategoryMultiple[] = [...byCat.entries()]
    .filter(([, rs]) => rs.length >= 4)
    .map(([category, rs]) => ({ category, n: rs.length, median_multiple: round4(median(rs)) }))
    .sort((a, b) => b.n - a.n || (a.category < b.category ? -1 : 1));
  const globalMedian = median(comps.map((p) => p.mcap_usd! / p.tvl_usd));
  const loo = looLogError(comps);
  return {
    n_comps: comps.length,
    intercept: round4(fit.intercept),
    slope: round4(fit.slope),
    r2: round4(fit.r2),
    global_median_multiple: round4(globalMedian),
    loo_median_log_error: round4(loo),
    loo_factor: round4(Math.exp(loo)),
    flat_median_log_error: round4(flatLogError(comps, globalMedian)),
    categories,
  };
}

/** A verdict from the implied value: Farm it, Thin (small, watch it), or Skip it. Cutoffs fit this
 *  snapshot's own range (top row about $69M): Farm at $40M or more, Thin at $15M or more. */
export function verdictFor(implied: number): 'Farm' | 'Thin' | 'Skip' {
  if (implied >= 40_000_000) return 'Farm';
  if (implied >= 15_000_000) return 'Thin';
  return 'Skip';
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const calibration = calibrate(snapshot, model);
  const comps = snapshot.protocols.filter(isComp);
  const fit = fitLogLog(comps);
  const byCat = new Map<string, number[]>();
  for (const p of comps) {
    const key = p.category ?? 'Other';
    const arr = byCat.get(key) ?? [];
    arr.push(p.mcap_usd! / p.tvl_usd);
    byCat.set(key, arr);
  }
  const catMedians = new Map<string, { median: number; n: number }>(
    [...byCat.entries()].map(([k, rs]) => [k, { median: median(rs), n: rs.length }]),
  );
  const looFactor = calibration.loo_factor;

  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but
  // the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped, and never a
  // wrapped, staked or bridged product. Never a replacement for a watchlist row.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model, fit, catMedians, looFactor);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.age,
    implied_value_usd: s.implied,
    verdict: verdictFor(s.implied),
    model: {
      category_multiple: round4(s.multiple),
      category_n: s.categoryN,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
      implied_low_usd: s.low,
      implied_high_usd: s.high,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's core action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow 30% of it in the chain's blue-chip asset and repay it before you exit.`;
  if (c.includes('dex') || c.includes('leveraged farm'))
    return `Provide $${capital} of liquidity to ${name}'s deepest USDC pair on ${chain} and swap $20 through it once a week.`;
  if (c.includes('yield aggregator') || c.includes('yield'))
    return `Deposit $${capital} of USDC into ${name}'s highest-TVL vault on ${chain} and let the yield compound in the vault.`;
  if (c.includes('bridge'))
    return `Bridge $${capital} of USDC to ${chain} through ${name} once a month and use the bridged funds in its app the same day.`;
  if (c.includes('staking') || c.includes('restak'))
    return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token in the same wallet.`;
  if (c.includes('perpetual') || c.includes('derivative'))
    return `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small hedged perpetual position each week.`;
  if (c.includes('prediction'))
    return `Fund $${capital} on ${name} on ${chain} and place one small market position each week on a market you understand.`;
  if (c.includes('curator') || c.includes('allocator'))
    return `Deposit $${capital} of USDC into a ${name} vault on ${chain} and keep the vault shares in the same wallet.`;
  if (c.includes('stable'))
    return `Mint $${capital} of the stable asset through ${name} on ${chain} against USDC collateral and hold the mint.`;
  if (c.includes('rwa'))
    return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it for the full qualifying window.`;
  if (c.includes('insurance'))
    return `Buy $${capital} of cover from ${name} on ${chain} for a protocol you already use and keep the policy active.`;
  if (c.includes('basis'))
    return `Deposit $${capital} of USDC into ${name}'s basis vault on ${chain} and keep the position through one funding cycle.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and use its main feature once a week.`;
}

/** The category's second, recurring action: what "stay active" concretely means here. */
function recurringFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return 'Each week, adjust the borrow by $10 or repay and re-borrow a small amount so the position shows fresh activity.';
  if (c.includes('dex') || c.includes('leveraged farm'))
    return 'Each week, swap $20 through the pool and collect the fees, so the wallet shows trading volume as well as liquidity.';
  if (c.includes('yield'))
    return 'Each week, claim the vault yield and redeposit it, so the wallet shows compounding activity, not one deposit.';
  if (c.includes('bridge'))
    return 'Each month, bridge a fresh $25 in the opposite direction, so the wallet shows two-way bridge use.';
  if (c.includes('staking') || c.includes('restak'))
    return 'Each week, restake the staking rewards the position earns, so the wallet shows compounding, not one stake.';
  if (c.includes('perpetual') || c.includes('derivative'))
    return 'Each week, close the hedge and open a fresh small one, so the wallet shows repeated trading, not one trade.';
  if (c.includes('curator') || c.includes('allocator'))
    return 'Each month, add $25 to the same vault, so the wallet shows a growing allocation, not a single deposit.';
  if (c.includes('rwa'))
    return 'Each month, mint $25 more of the yield asset, so the wallet shows a growing holding, not a single mint.';
  return 'Each week, use the protocol once more — a deposit, a swap, a vote or a claim — so the wallet shows repeat use.';
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const gas = capital >= 150 ? 8 : 4;
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: recurringFor(p),
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    implied_low_usd: row.model.implied_low_usd,
    implied_high_usd: row.model.implied_high_usd,
    verdict: row.verdict,
    category_multiple: row.model.category_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    calibration: calibrate(snapshot, model),
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
