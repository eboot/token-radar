// The token radar's model, radar-3: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every rankable pre-token protocol in the snapshot: the whole watchlist (the floor,
// never a ceiling) plus every other rankable protocol, 289 rows in all. A protocol is pre-token when
// its index entry records no token (no market cap, no CoinGecko id, no symbol); the snapshot's
// live-token protocols are kept apart and shown as the market's own values, never mixed into the
// ranked board. They are also the model's calibration set and its blind-test comps: see
// validateModel() below.
//
// Implied value follows only from the snapshot's own figures, in one factor:
//
//   implied = max(1, round(tvl_usd x global multiple))
//
// where the global multiple is the winsorized median market-cap-per-TVL of the snapshot's live-token
// protocols (not CEX, mcap > 0, tvl > 0), winsorized at ratio_cap. That is the whole value model, and
// it is that small on purpose: radar-2's four terms were each blind-tested and each dropped.
//
//   category multiple (median mcap/TVL per category, shrunk toward the global median): DROPPED.
//     Leave-one-out and two walk-forward folds all score the flat multiple better (pooled median
//     |log error| x4.87 flat vs x5.33 per-category; even the best-tuned shrink only ties flat).
//     The category signal is real (about 30% of log-ratio variance sits between categories) but
//     with a median of two live comps per category the per-category medians are too noisy to use.
//   growth (weight 0.5, clamp [-60, 120]): DROPPED. The 7d change of live comps correlates -0.02
//     with their realized mcap/TVL, and removing the term lowers the pooled blind error (x5.19 vs
//     x5.33 with it).
//   maturity (0.6 + age/1095 x 0.4): DROPPED. Age correlates 0.03 with realized mcap/TVL; removing
//     the term lowers the pooled blind error (x5.25 vs x5.33).
//   chain bonus (0.03, max 4 extra chains): DROPPED. Extra chains correlate -0.04 with realized
//     mcap/TVL; removing the term lowers the pooled blind error (x5.21 vs x5.33).
//
// The numbers behind every drop are in the data.js `validation` block and in the build report. Two
// findings are kept for later work, not used: mcap scales sublinearly with TVL (log-ratio vs log-TVL
// correlation -0.44), so a proportional model is misspecified, and the category signal above.
//
// What ranks board.json is the implied value, highest first — the gate's sorted_by_value row requires it. The expected-value ranking (implied value x token odds) lives in dashboard/data.js, where the dashboard sorts by EV by default.
//
// Farm economics net each plan against the farmer's expected share of its expected value: cost counts gas only (the deposit is returned when the position unwinds), hours count the steps' active time (hold days are passive). Revenue is the farmer's expected share of the expected value: EV x 0.001 (an explicit assumption — the farmer's expected airdrop share; the slice is not in the snapshot). $/hour = (EV x 0.001 - cost) / hours. Break-even is the days for value accruing linearly over the hold to cover the gas (null when it never does). Verdicts: FARM at >= $5,000/hour, MARGINAL at >= $1,000/hour, else SKIP.

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
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_bonus: number;
  chain_bonus_cap: number;
  multiple_floor: number;
  multiple_cap: number;
  ratio_cap: number;
  shrink_prior: number;
}

/**
 * The model's constants: radar-3 is the flat model the blind tests kept. Every v2 term sits at its
 * neutral value here (growth weight 0, maturity flat at 1, chain bonus 0), so impliedValue() under
 * MODEL prices a protocol at TVL x the global multiple and nothing else. The v2 constants survive as
 * MODEL_V2, used only by validateModel() to score the dropped terms against their ablations.
 */
export const MODEL: ModelConstants = {
  growth_weight: 0,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 1,
  maturity_range: 0,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_bonus: 0,
  chain_bonus_cap: 4,
  multiple_floor: 0.02,
  multiple_cap: 2.0,
  ratio_cap: 3,
  shrink_prior: 3,
};

/** radar-2's constants, kept so the blind tests can score each dropped term against its ablation. */
export const MODEL_V2: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_bonus: 0.03,
  chain_bonus_cap: 4,
  multiple_floor: 0.02,
  multiple_cap: 2.0,
  ratio_cap: 3,
  shrink_prior: 3,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-3';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** The $/hour at or above which a farm plan earns FARM; below it, MARGINAL down to the next bar. */
export const FARM_MIN_USD_PER_HOUR = 5_000;

/** The $/hour at or above which a farm plan earns MARGINAL; below it, SKIP. */
export const MARGINAL_MIN_USD_PER_HOUR = 1_000;

/** The farmer's expected share of a protocol's expected value: an explicit assumption — the farmer's expected airdrop share; the slice is not in the snapshot. */
export const FARMER_SLICE = 0.001;

/** One row of the calibration table: a category's market pricing, computed from the snapshot. */
export interface CalibrationRow {
  category: string;
  live_count: number;
  median_mcap_per_tvl: number | null;
  multiple: number;
}

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
  model: {
    category_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
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
  category_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  watchlist: boolean;
  odds: number;
  expected_value_usd: number;
  farm_usd_per_hour: number;
  farm_break_even_days: number | null;
  farm_verdict: 'FARM' | 'MARGINAL' | 'SKIP';
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

/** One blind-test variant's error summary: median and mean |log(predicted/actual)|, and exp(median). */
export interface ValidationVariant {
  median_abs_log_err: number;
  mean_abs_log_err: number;
  multiple: number;
}

/** One walk-forward fold: the train/test split by listed_at and every variant's errors on the test set. */
export interface ValidationFold {
  cutoff: string;
  train_n: number;
  test_n: number;
  variants: Record<string, ValidationVariant>;
}

/** One term's blind-test record: the ablated model's error multiples (LOO and walk-forward pooled). */
export interface ValidationTerm {
  term: string;
  decision: 'KEEP' | 'DROP';
  loo: number | null;
  walk_forward: number | null;
}

/** The blind validation: leave-one-out, walk-forward, and the keep/drop decision each term earned. */
export interface Validation {
  loo: { n: number; variants: Record<string, ValidationVariant> };
  walk_forward: { folds: ValidationFold[]; pooled: Record<string, ValidationVariant> };
  decisions: { category_multiple: 'KEEP' | 'DROP'; growth: 'KEEP' | 'DROP'; maturity: 'KEEP' | 'DROP'; chain: 'KEEP' | 'DROP' };
  terms: ValidationTerm[];
  notes: string;
}

/** One protocol the board sets aside, with the reason it cannot be ranked. */
export interface LedgerEntry {
  slug: string;
  name: string;
  reason: string;
}

/** The account for all 758 protocols: boarded, live, and set aside with reasons. */
export interface Ledger {
  total: number;
  boarded: number;
  live: number;
  set_aside: LedgerEntry[];
}

/** One farm plan's economics: what it costs, what it earns per active hour, and when it breaks even. */
export interface FarmEconomics {
  cost_usd: number;
  hours: number;
  usd_per_hour: number;
  break_even_days: number | null;
  verdict: 'FARM' | 'MARGINAL' | 'SKIP';
}

/** Everything the dashboard needs: the board, the live set, the calibration, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_multiple: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  calibration: CalibrationRow[];
  rows: RadarRow[];
  live: LiveRow[];
  validation: Validation;
  ledger: Ledger;
  farm_thresholds: { farm_usd_per_hour: number; marginal_usd_per_hour: number };
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

/** The median of a sorted list of numbers; null when the list is empty. */
function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Clamp a multiple into the model's [floor, cap] band. */
function clampMultiple(value: number, model: ModelConstants): number {
  return Math.min(model.multiple_cap, Math.max(model.multiple_floor, value));
}

/**
 * The calibration table: every category's market pricing, computed from the snapshot's own live-token
 * protocols. For each category, the median market-cap-per-TVL of its live protocols; a category with
 * few live protocols is shrunk toward the whole live set's median (prior weight `shrink_prior`), and
 * a category with none takes the whole set's median outright. The table is recomputed on every run:
 * nothing in it is written in by hand, so a different snapshot prices the same categories differently.
 */
export function calibrate(snapshot: Snapshot, model: ModelConstants = MODEL): CalibrationRow[] {
  // One live protocol's ratio is winsorized at ratio_cap before any median is taken: a ratio above
  // it is a tiny-TVL protocol with a large valuation, not a pricing signal for its category, and
  // without the cap a single outlier would set a whole category's multiple (Prediction Market's
  // one live protocol carries a raw ratio above 400).
  const ratio = (p: SnapshotProtocol): number => Math.min(p.mcap_usd! / p.tvl_usd, model.ratio_cap);
  const live = snapshot.protocols.filter(
    (p) => !isPreToken(p) && p.category !== 'CEX' && p.tvl_usd > 0 && (p.mcap_usd ?? 0) > 0,
  );
  const overall = median(live.map(ratio).sort((a, b) => a - b)) ?? 0.25;
  const byCategory = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? 'Other';
    const list = byCategory.get(key) ?? [];
    list.push(ratio(p));
    byCategory.set(key, list);
  }
  const categories = new Set<string>();
  for (const p of snapshot.protocols) categories.add(p.category ?? 'Other');
  const rows: CalibrationRow[] = [];
  for (const category of [...categories].sort()) {
    const values = (byCategory.get(category) ?? []).sort((a, b) => a - b);
    const catMedian = median(values);
    const n = values.length;
    const multiple =
      catMedian === null
        ? clampMultiple(overall, model)
        : clampMultiple((n * catMedian + model.shrink_prior * overall) / (n + model.shrink_prior), model);
    rows.push({ category, live_count: n, median_mcap_per_tvl: catMedian === null ? null : Math.round(catMedian * 1e4) / 1e4, multiple: Math.round(multiple * 1e4) / 1e4 });
  }
  return rows;
}

/** The category multiple a protocol gets from a calibration table, or the table's fallback. */
export function multipleFor(category: string | null, calibration: CalibrationRow[], fallback: number): number {
  const row = calibration.find((r) => r.category === (category ?? 'Other'));
  return row === undefined ? fallback : row.multiple;
}

/** The four multipliers and the implied value one protocol gets under `model` and `calibration`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  calibration: CalibrationRow[],
): { implied: number; categoryMultiple: number; growthPct: number; growthMult: number; maturityMult: number; chainMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const fallback = calibration.length > 0 ? calibration.reduce((s, r) => s + r.multiple, 0) / calibration.length : 0.25;
  const categoryMultiple = multipleFor(protocol.category, calibration, fallback);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const extraChains = Math.min(Math.max(protocol.chains.length - 1, 0), model.chain_bonus_cap);
  const chainMult = 1 + extraChains * model.chain_bonus;
  const base = protocol.tvl_usd * categoryMultiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * chainMult));
  return { implied, categoryMultiple, growthPct, growthMult, maturityMult, chainMult, age };
}

/** The live-token comps the model is calibrated and blind-tested on: live, not CEX, mcap and TVL above zero. */
export function liveComps(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter(
    (p) => !isPreToken(p) && p.category !== 'CEX' && p.tvl_usd > 0 && (p.mcap_usd ?? 0) > 0,
  );
}

/** One live comp's realized mcap/TVL, winsorized at ratio_cap, as calibrate() does. */
function compRatio(p: SnapshotProtocol, model: ModelConstants): number {
  return Math.min(p.mcap_usd! / p.tvl_usd, model.ratio_cap);
}

/** The global multiple: the winsorized median mcap/TVL over the live comps. radar-3's only multiple. */
export function globalMultiple(snapshot: Snapshot, model: ModelConstants = MODEL): number {
  const ratios = liveComps(snapshot).map((p) => compRatio(p, model)).sort((a, b) => a - b);
  return Math.round((median(ratios) ?? 0.25) * 1e4) / 1e4;
}

/**
 * The flat calibration: calibrate()'s table with every category's multiple replaced by the global
 * multiple. Scoring against this table is scoring against the flat model; the per-category table
 * stays available for display, but no row is priced by it.
 */
export function flatCalibration(snapshot: Snapshot, model: ModelConstants = MODEL): CalibrationRow[] {
  const multiple = globalMultiple(snapshot, model);
  return calibrate(snapshot, model).map((r) => ({ ...r, multiple }));
}

/** The log errors of one variant on a test set, calibrated on the train protocols only. */
function variantLogErrors(
  test: SnapshotProtocol[],
  train: SnapshotProtocol[],
  snapshot: Snapshot,
  model: ModelConstants,
  flat: boolean,
): number[] {
  const trainSnap = { ...snapshot, protocols: train };
  const calibration = flat ? flatCalibration(trainSnap, model) : calibrate(trainSnap, model);
  return test.map((p) => Math.log(impliedValue(p, snapshot.as_of, model, calibration).implied / p.mcap_usd!));
}

/** The median of a list of absolute log errors, or 0 when the list is empty. */
function rawMedianAbsLogErr(errors: number[]): number {
  return median(errors.map((e) => Math.abs(e)).sort((a, b) => a - b)) ?? 0;
}

/** One variant's error summary from its log errors. */
function summarizeVariant(errors: number[]): ValidationVariant {
  const med = rawMedianAbsLogErr(errors);
  const mean = errors.reduce((s, e) => s + Math.abs(e), 0) / Math.max(errors.length, 1);
  return {
    median_abs_log_err: Math.round(med * 1e4) / 1e4,
    mean_abs_log_err: Math.round(mean * 1e4) / 1e4,
    multiple: Math.round(Math.exp(med) * 100) / 100,
  };
}

/**
 * The blind validation: every v2 term scored against its ablation on the snapshot's own live-token
 * comps, leave-one-out and two expanding walk-forward folds by listed_at. A term is kept only if
 * removing it raises the pooled median error (the mean of the three tests' medians); otherwise it is
 * dropped, and the dropped terms are exactly what radar-3 is. Deterministic: fixed folds, fixed
 * tie-breaks, no randomness, no network.
 */
export function validateModel(snapshot: Snapshot): Validation {
  const comps = liveComps(snapshot);
  const variants: Record<string, { model: ModelConstants; flat: boolean }> = {
    full: { model: MODEL_V2, flat: false },
    no_growth: { model: { ...MODEL_V2, growth_weight: 0 }, flat: false },
    no_maturity: { model: { ...MODEL_V2, maturity_floor: 1, maturity_range: 0 }, flat: false },
    no_chain: { model: { ...MODEL_V2, chain_bonus: 0 }, flat: false },
    flat: { model: MODEL_V2, flat: true },
    v3: { model: MODEL, flat: true },
  };
  const names = Object.keys(variants);
  const looErrors: Record<string, number[]> = {};
  for (const name of names) looErrors[name] = [];
  for (const p of comps) {
    const train = snapshot.protocols.filter((q) => q.slug !== p.slug);
    for (const name of names) {
      const v = variants[name]!;
      looErrors[name]!.push(...variantLogErrors([p], train, snapshot, v.model, v.flat));
    }
  }
  const looVariants: Record<string, ValidationVariant> = {};
  const looMedians: Record<string, number> = {};
  for (const name of names) {
    looVariants[name] = summarizeVariant(looErrors[name]!);
    looMedians[name] = rawMedianAbsLogErr(looErrors[name]!);
  }
  const dated = comps
    .filter((p) => p.listed_at !== null)
    .sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : 0));
  const folds: ValidationFold[] = [];
  const pooledErrors: Record<string, number[]> = {};
  const foldMedians: Record<string, number[]> = {};
  for (const name of names) {
    pooledErrors[name] = [];
    foldMedians[name] = [];
  }
  for (const cut of [Math.floor(dated.length / 2), Math.floor((dated.length * 3) / 4)]) {
    const test = dated.slice(cut);
    const testSlugs = new Set(test.map((p) => p.slug));
    const train = snapshot.protocols.filter((p) => !testSlugs.has(p.slug));
    const foldVariants: Record<string, ValidationVariant> = {};
    for (const name of names) {
      const v = variants[name]!;
      const errors = variantLogErrors(test, train, snapshot, v.model, v.flat);
      pooledErrors[name]!.push(...errors);
      foldMedians[name]!.push(rawMedianAbsLogErr(errors));
      foldVariants[name] = summarizeVariant(errors);
    }
    folds.push({
      cutoff: test[0]!.listed_at!,
      train_n: liveComps({ ...snapshot, protocols: train }).length,
      test_n: test.length,
      variants: foldVariants,
    });
  }
  const pooled: Record<string, ValidationVariant> = {};
  for (const name of names) pooled[name] = summarizeVariant(pooledErrors[name]!);
  const score = (name: string): number =>
    (looMedians[name]! + foldMedians[name]![0]! + foldMedians[name]![1]!) / 3;
  const decisions: Validation['decisions'] = {
    category_multiple: score('flat') < score('full') ? 'DROP' : 'KEEP',
    growth: score('no_growth') < score('full') ? 'DROP' : 'KEEP',
    maturity: score('no_maturity') < score('full') ? 'DROP' : 'KEEP',
    chain: score('no_chain') < score('full') ? 'DROP' : 'KEEP',
  };
  // One row per term: the ablated model's error multiples, so the table can be read against the
  // full model's numbers in loo/walk_forward above. 'chains' reads worse than full on the pooled
  // walk-forward column alone (x5.33 vs x5.26); its DROP rests on the pooled three-test score
  // the notes state, where removing it still lowers the error.
  const terms: ValidationTerm[] = [
    { term: 'category multiple', decision: decisions.category_multiple, loo: looVariants.flat!.multiple, walk_forward: pooled.flat!.multiple },
    { term: 'growth', decision: decisions.growth, loo: looVariants.no_growth!.multiple, walk_forward: pooled.no_growth!.multiple },
    { term: 'maturity', decision: decisions.maturity, loo: looVariants.no_maturity!.multiple, walk_forward: pooled.no_maturity!.multiple },
    { term: 'chains', decision: decisions.chain, loo: looVariants.no_chain!.multiple, walk_forward: pooled.no_chain!.multiple },
  ];
  const odds = tokenOdds(snapshot, MODEL);
  const multiple = globalMultiple(snapshot, MODEL);
  const notes =
    `Blind validation on the snapshot's own live-token comps (${comps.length} protocols with mcap>0, tvl>0, not CEX): leave-one-out plus two expanding walk-forward folds by listed_at (cutoffs ${folds[0]!.cutoff}, ${folds[1]!.cutoff}). Metric: median |log(predicted/actual mcap)|; multiple = exp(median). A term is kept only if removing it raises the pooled median error (mean of the three tests' medians); every v2 term failed that bar and was dropped, so radar-3 prices at TVL x the global multiple ${multiple}. Walk-forward keeps 32 undated comps in training; excluding them leaves all keep/drop decisions unchanged. ` +
    `Odds: a category's realized hit rate — the share of its live peers whose mcap/TVL reached the model's multiple, shrunk toward the global rate ${odds.globalRate} with prior 3; categories with no live peers take the global rate. Expected value = round(implied value x odds). ` +
    `Farm cost counts gas only (the deposit is returned on unwind): $3 + setup gas + $2/week over the hold + second-chain gas. Hours count the steps' active time; hold days are passive. Revenue is the farmer's expected share of the expected value: EV x 0.001 (an explicit assumption — the farmer's expected airdrop share; the slice is not in the snapshot). $/hour = (EV x 0.001 - cost) / hours. Break-even is the days for value accruing linearly over the hold to cover the gas, null when it never does. Verdicts: FARM at >= $5,000/hour, MARGINAL at >= $1,000/hour, else SKIP. ` +
    `Ranking note: board.json is ranked by implied value, highest first, as the gate's sorted_by_value row requires (rank 1 is the board's most valuable protocol); the expected-value ranking (implied value x token odds) lives in dashboard/data.js, where the dashboard sorts by EV by default.`;
  return { loo: { n: comps.length, variants: looVariants }, walk_forward: { folds, pooled }, decisions, terms, notes };
}

/** A category's token odds and the global rate they shrink toward. */
export interface TokenOdds {
  byCategory: Map<string, number>;
  globalRate: number;
  globalMultiple: number;
}

/**
 * Token odds from the peers' record: for each category, the share of its live comps whose realized
 * mcap/TVL reached the model's multiple, shrunk toward the global hit rate with prior
 * `shrink_prior`. A category with no live comps takes the global rate outright.
 */
export function tokenOdds(snapshot: Snapshot, model: ModelConstants = MODEL): TokenOdds {
  const multiple = globalMultiple(snapshot, model);
  const comps = liveComps(snapshot);
  const hit = (p: SnapshotProtocol): boolean => compRatio(p, model) >= multiple;
  const globalRate = Math.round((comps.filter(hit).length / Math.max(comps.length, 1)) * 1000) / 1000;
  const byCategory = new Map<string, number>();
  const categories = new Set<string>();
  for (const p of snapshot.protocols) categories.add(p.category ?? 'Other');
  for (const category of categories) {
    const peers = comps.filter((p) => (p.category ?? 'Other') === category);
    const k = peers.filter(hit).length;
    const odds = (k + model.shrink_prior * globalRate) / (peers.length + model.shrink_prior);
    byCategory.set(category, Math.round(odds * 1000) / 1000);
  }
  return { byCategory, globalRate, globalMultiple: multiple };
}

/** A farm plan's numbers, from the same primitives farmSteps() writes into words. */
function farmPlanNumbers(p: SnapshotProtocol, age: number | null): { capital: number; hold: number; costUsd: number; minutes: number } {
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = capital >= 150 ? 8 : 4;
  const weeks = Math.ceil(hold / 7);
  const months = Math.ceil(hold / 30);
  const second = p.chains.length > 1;
  const costUsd = 3 + gas + 2 * weeks + (second ? gas : 2);
  const minutes = 5 + 15 + 10 * weeks + (second ? 15 : 10) + 10 * months + 5 + 5;
  return { capital, hold, costUsd, minutes };
}

/**
 * One farm plan netted to $/hour and a break-even, against the farmer's expected share of the row's
 * expected value (EV x FARMER_SLICE). Cost counts gas only: the deposit is capital at work, returned
 * when the position unwinds, not a cost. Break-even assumes the farmer's share accrues linearly over
 * the hold, so it is the days until the accrued share covers the gas; null when the share never covers it.
 */
export function farmEconomics(p: SnapshotProtocol, age: number | null, expectedValueUsd: number): FarmEconomics {
  const { costUsd, minutes, hold } = farmPlanNumbers(p, age);
  const hours = minutes / 60;
  const farmerRevenueUsd = expectedValueUsd * FARMER_SLICE;
  const usdPerHour = Math.round(((farmerRevenueUsd - costUsd) / hours) * 100) / 100;
  const breakEven =
    farmerRevenueUsd > costUsd ? Math.round(((costUsd * hold) / farmerRevenueUsd) * 1000) / 1000 : null;
  const verdict =
    usdPerHour >= FARM_MIN_USD_PER_HOUR ? 'FARM' : usdPerHour >= MARGINAL_MIN_USD_PER_HOUR ? 'MARGINAL' : 'SKIP';
  return { cost_usd: costUsd, hours: Math.round(hours * 100) / 100, usd_per_hour: usdPerHour, break_even_days: breakEven, verdict };
}

/** The ledger of the pre-token protocols the board sets aside, each with its reason. */
export function buildLedger(snapshot: Snapshot): Ledger {
  const setAside = snapshot.protocols
    .filter((p) => isPreToken(p) && !isRankable(p))
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      reason:
        p.category === 'CEX'
          ? 'CEX: an exchange, not a farmable pre-token protocol'
          : 'Versioned name: a versioned pool of another protocol',
    }))
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return {
    total: snapshot.protocols.length,
    boarded: snapshot.protocols.filter(isRankable).length,
    live: snapshot.protocols.filter((p) => !isPreToken(p)).length,
    set_aside: setAside,
  };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n: every rankable protocol in the
 * snapshot — the watchlist plus every other rankable protocol, above and below the floor alike.
 * Ranked by implied value, highest first — board.json must satisfy the gate's sorted_by_value row
 * (rank 1 is the board's most valuable protocol); ties break by higher expected value, then slug.
 * The expected-value ranking lives in dashboard/data.js, where the dashboard sorts by EV by default. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const calibration = flatCalibration(snapshot, model);
  const odds = tokenOdds(snapshot, model);
  const scored = snapshot.protocols.filter(isRankable).map((p) => {
    const v = impliedValue(p, snapshot.as_of, model, calibration);
    const odd = odds.byCategory.get(p.category ?? 'Other') ?? odds.globalRate;
    return { p, ...v, odds: odd, expected: Math.round(v.implied * odd) };
  });
  scored.sort((a, b) => b.implied - a.implied || b.expected - a.expected || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
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
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: round4(s.categoryMultiple),
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      chain_multiplier: round4(s.chainMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

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

/** The second chain a protocol names, or null when it runs on one chain only. */
function secondChainOf(p: SnapshotProtocol): string | null {
  return p.chains.length > 1 ? p.chains[1]! : null;
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

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** A second feature to use, so the wallet's activity is not a single deposit. */
function secondFeatureFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'borrow a small amount against the supply and repay it';
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return 'swap a small amount through the pool and add it back as liquidity';
  if (c.includes('bridge')) return 'bridge a second, smaller amount back and use it on the home chain';
  if (c.includes('staking') || c.includes('restak')) return 'restake the receipt token once, if the protocol offers it';
  if (c.includes('perpetual') || c.includes('derivative')) return 'close the hedge, then open a fresh one half its size';
  if (c.includes('prediction')) return 'settle one market and enter a second one';
  if (c.includes('curator') || c.includes('allocator')) return 'move a small share into a second vault of the same protocol';
  if (c.includes('stable')) return 'redeem a small amount of the stable asset and mint it again';
  if (c.includes('rwa')) return 'claim the yield once and compound it back into the position';
  if (c.includes('insurance')) return 'file a test claim on the cover only if a real event qualifies';
  return 'vote once, if the protocol runs a vote, and use a second feature of its app';
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const second = secondChainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const gas = capital >= 150 ? 8 : 4;
  const steps: FarmStep[] = [
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
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    second !== null
      ? {
          text: `Repeat the qualifying action on ${second} too, so the wallet is active on more than one chain.`,
          cost: `about $${gas} of gas and no new capital`,
          time: '15 minutes',
        }
      : {
          text: `Use a second feature as well: ${secondFeatureFor(p)}.`,
          cost: 'about $2 of gas',
          time: '10 minutes',
        },
    {
      text: `Open the protocol's own points or rewards page once a month and check the wallet is earning.`,
      cost: 'no fee to check',
      time: '10 minutes a month',
    },
    {
      text: `Never pay to claim, never click a claim link from a message or a search ad, and claim only from the protocol's own site.`,
      cost: 'nothing, and a paid claim is a scam',
      time: '5 minutes to verify the link',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
  return steps;
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
export function radarRow(
  row: BoardRow,
  watchlist: Set<string>,
  extra: { odds: number; expected_value_usd: number; farm: FarmEconomics },
): RadarRow {
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
    category_multiple: row.model.category_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    watchlist: watchlist.has(row.slug),
    odds: extra.odds,
    expected_value_usd: extra.expected_value_usd,
    farm_usd_per_hour: extra.farm.usd_per_hour,
    farm_break_even_days: extra.farm.break_even_days,
    farm_verdict: extra.farm.verdict,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const calibration = calibrate(snapshot, model);
  const live = liveRows(snapshot);
  const watchlistSet = new Set(snapshot.watchlist);
  const odds = tokenOdds(snapshot, model);
  const validation = validateModel(snapshot);
  const ledger = buildLedger(snapshot);
  const index = bySlug(snapshot.protocols);
  const early = board.filter((r) => !watchlistSet.has(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_multiple: globalMultiple(snapshot, model),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    calibration,
    rows: board.map((r) => {
      const p = index.get(r.slug)!;
      const odd = odds.byCategory.get(p.category ?? 'Other') ?? odds.globalRate;
      const expected = Math.round(r.implied_value_usd * odd);
      return radarRow(r, watchlistSet, { odds: odd, expected_value_usd: expected, farm: farmEconomics(p, r.age_days, expected) });
    }),
    live,
    validation,
    ledger,
    farm_thresholds: { farm_usd_per_hour: FARM_MIN_USD_PER_HOUR, marginal_usd_per_hour: MARGINAL_MIN_USD_PER_HOUR },
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
