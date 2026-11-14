// Radar-2: turning a sealed snapshot of the protocol universe into a ranked launch board.
//
// The board starts from the snapshot's watchlist — every pre-token protocol with at least $50M
// of TVL and no token on record — and then looks further down: any other pre-token protocol
// that fits the watchlist's own definition joins the board at whatever TVL it has, because
// the point of the radar is to find launches before they are obvious. Protocols whose token
// already trades are set aside and shown with the market's own numbers, never ranked.
//
// A protocol's implied value comes only from its own record, never from a list of names:
// TVL sets the scale (a launch is worth a quarter of TVL), the week's move bends it, the
// time spent running without a token seasons it, and smallness adds a premium — a $5M
// protocol's token can be worth more per dollar of TVL than a $2B one's. The four dials are
// printed in the dashboard, so the ranking can be followed row by row.
//
// Every ranked row also carries a farm plan: seven steps built from the protocol's own
// category, chains, TVL and age, with the capital, the gas and the hold time spelled out.

// One protocol as the snapshot lists it, trimmed to the fields the radar reads.
interface Proto {
  id: string;
  label: string;
  sector: string | null;
  networks: string[];
  tvl: number;
  weekChange: number | null;
  mcap: number | null;
  listed: string | null;
  gecko: string | null;
  ticker: string | null;
}

// The snapshot document as a whole.
interface Snap {
  refDate: string;
  origin: string;
  floor: number;
  entries: Proto[];
  watch: string[];
}

// The radar's dials, with the numbers the dashboard prints beside the board.
const TUNING = {
  baseMultiple: 0.25,
  growthWeight: 0.5,
  growthFloor: -75,
  growthCap: 300,
  maturityFloor: 0.5,
  maturityRange: 0.5,
  maturityDays: 1460,
  unknownAge: 365,
  sizePremium: 0.3,
};

type Tuning = typeof TUNING;

// The radar's own tag, printed by the dashboard.
const RADAR_TAG = 'radar-2';

// How many already-trading protocols the live view shows, richest first.
const LIVE_COUNT = 24;

// The status every ranked row carries: its token has not launched yet.
const PRE_TOKEN = 'pre-token';

// One scored protocol: the entry plus the numbers the board prints for it.
interface Scored {
  entry: Proto;
  worth: number;
  clipped: number;
  growthFactor: number;
  maturityFactor: number;
  sizeFactor: number;
  days: number | null;
}

// One farm-plan line: what to do, what it costs, how long it takes.
interface PlanStep {
  action: string;
  price: string;
  span: string;
}

const MS_PER_DAY = 86_400_000;

// Days from `listed` up to `refDate`, whole days, never below zero; null when the listing
// date is missing or unreadable.
function daysSinceListing(refDate: string, listed: string | null): number | null {
  if (listed === null) return null;
  const ref = Date.parse(refDate + 'T00:00:00Z');
  const first = Date.parse(listed + 'T00:00:00Z');
  if (!Number.isFinite(ref) || !Number.isFinite(first)) return null;
  const span = Math.floor((ref - first) / MS_PER_DAY);
  return span < 0 ? 0 : span;
}

// A finite number, or `fallback` when the value is missing or not a number.
function numOr(value: unknown, fallback: number): number {
  if (typeof value !== 'number') return fallback;
  if (!Number.isFinite(value)) return fallback;
  return value;
}

// Four decimals, the precision the board prints for multipliers.
function round4dp(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

// Score one protocol. TVL sets the scale, the week's move bends it, the wait without a
// token seasons it, and smallness adds a premium. The same dials score every protocol:
// a name is never special-cased, so the ranking follows the record alone.
function scoreOne(entry: Proto, refDate: string, floor: number, tune: Tuning): Scored {
  const days = daysSinceListing(refDate, entry.listed);
  const weekly = numOr(entry.weekChange, 0);
  const clipped = Math.min(tune.growthCap, Math.max(tune.growthFloor, weekly));
  const growthFactor = 1 + (clipped / 100) * tune.growthWeight;
  const lived = days ?? tune.unknownAge;
  const capped = Math.min(Math.max(lived, 0), tune.maturityDays);
  const maturityFactor = tune.maturityFloor + (capped / tune.maturityDays) * tune.maturityRange;
  const sizeFactor = 1 + tune.sizePremium * Math.min(Math.max(Math.log10(floor / entry.tvl), 0), 1);
  const worth = Math.max(1, Math.round(entry.tvl * tune.baseMultiple * growthFactor * maturityFactor * sizeFactor));
  return { entry, worth, clipped, growthFactor, maturityFactor, sizeFactor, days };
}

// A name ending in a release number is a pool of another protocol, not a launch of its own.
const VERSION_MARK = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
// A whole word wrapped, staked or staking marks a product of a token that already trades.
const WRAPPED_TERM = /\b(wrapped|staked|staking)\b/i;
// A name starting with an exchange's name is that exchange's product, not a launch.
const EXCHANGE_LEAD = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
// Sectors the watchlist's own rule keeps out: bridged, staked and exchange products.
const BARRED_SECTORS = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

// True when the record carries no token at all: no market cap, no CoinGecko id, no symbol.
function hasNoToken(e: Proto): boolean {
  return e.mcap === null && e.gecko === null && e.ticker === null;
}

// True when the board may rank a protocol: pre-token and passing the watchlist's own
// definition. The TVL floor is not part of this test; the board ranks below the floor too.
function eligible(e: Proto): boolean {
  if (!hasNoToken(e)) return false;
  if (BARRED_SECTORS.has(e.sector ?? '')) return false;
  if (VERSION_MARK.test(e.label)) return false;
  if (WRAPPED_TERM.test(e.label)) return false;
  if (EXCHANGE_LEAD.test(e.label)) return false;
  return true;
}

// The snapshot's entries by id.
function indexById(entries: Proto[]): Map<string, Proto> {
  const out = new Map<string, Proto>();
  for (const e of entries) out.set(e.id, e);
  return out;
}

// The ranked board: every watchlist slug the snapshot carries, plus every other pre-token
// protocol that meets the watchlist's own definition, strongest implied value first, ranks 1..n.
export function rankProtocols(snap: Snap, tune: Tuning = TUNING) {
  const lookup = indexById(snap.entries);
  const picked = new Map<string, Proto>();
  for (const id of snap.watch) {
    const found = lookup.get(id);
    if (found !== undefined) picked.set(id, found);
  }
  for (const e of snap.entries) {
    if (!picked.has(e.id) && eligible(e)) picked.set(e.id, e);
  }
  const scored: Scored[] = [];
  for (const e of picked.values()) scored.push(scoreOne(e, snap.refDate, snap.floor, tune));
  scored.sort((x, y) => {
    if (y.worth !== x.worth) return y.worth - x.worth;
    if (x.entry.id < y.entry.id) return -1;
    if (x.entry.id > y.entry.id) return 1;
    return 0;
  });
  return scored.map((s, i) => {
    const e = s.entry;
    const place = i + 1;
    return {
      rank: place,
      slug: e.id,
      name: e.label,
      category: e.sector,
      chains: e.networks,
      tvl_usd: e.tvl,
      change_7d: e.weekChange,
      mcap_usd: e.mcap,
      listed_at: e.listed,
      gecko_id: e.gecko,
      symbol: e.ticker,
      token_status: PRE_TOKEN,
      age_days: s.days,
      implied_value_usd: s.worth,
      model: {
        base_multiple: tune.baseMultiple,
        growth_pct: s.clipped,
        growth_multiplier: round4dp(s.growthFactor),
        maturity_multiplier: round4dp(s.maturityFactor),
        size_multiplier: round4dp(s.sizeFactor),
        age_days: s.days,
      },
      farm_steps: planFor(e, s.days).map(formatStep),
    };
  });
}

// The first chain a protocol names, or a neutral phrase when it names none.
function homeChain(e: Proto): string {
  return e.networks.length > 0 ? e.networks[0]! : 'its main chain';
}

// How much capital one farm position needs, from the protocol's own TVL.
function stakeSize(tvl: number): number {
  if (tvl >= 5_000_000_000) return 250;
  if (tvl >= 1_000_000_000) return 200;
  if (tvl >= 100_000_000) return 100;
  if (tvl >= 50_000_000) return 75;
  const smallest = 50;
  return smallest;
}

// What one transaction costs on a chain: Ethereum gas runs an order dearer than the rest.
function txFee(net: string): number {
  return net === 'Ethereum' ? 8 : 2;
}

// How long to hold, from the protocol's age: younger protocols get a longer qualifying window.
function holdWindow(days: number | null): number {
  if (days === null) return 30;
  if (days < 180) return 60;
  if (days < 365) return 45;
  return 30;
}

// A move rule: the words that pick it, and the sentence it writes. The first rule whose
// words appear in the category wins, so the table's order is the decision.
interface MoveRule {
  words: string[];
  write: (stake: number, label: string, net: string) => string;
}

// The first move, by what the protocol does.
const FIRST_MOVES: MoveRule[] = [
  { words: ['lend', 'cdp', 'collateral'], write: (s, n, c) => `Supply $${s} of USDC to ${n} on ${c} and keep the position open.` },
  { words: ['dex', 'leveraged farm'], write: (s, n, c) => `Provide $${s} of liquidity to ${n}'s main pool on ${c} and keep the position open.` },
  { words: ['yield aggregator', 'yield', 'farm'], write: (s, n, c) => `Deposit $${s} of USDC into ${n}'s highest-TVL vault on ${c} and keep the shares.` },
  { words: ['bridge'], write: (s, n, c) => `Bridge $${s} of USDC to ${c} through ${n} and use the bridged funds in its app.` },
  { words: ['staking', 'restak'], write: (s, n, c) => `Stake $${s} of the chain's staking asset through ${n} and keep the receipt.` },
  { words: ['perpetual', 'derivative'], write: (s, n, c) => `Deposit $${s} of USDC as margin on ${n} and open one small hedge.` },
  { words: ['prediction'], write: (s, n, c) => `Fund $${s} and place one market position on ${n}.` },
  { words: ['curator', 'allocator'], write: (s, n, c) => `Deposit $${s} into a ${n} vault on ${c} and keep the shares.` },
  { words: ['stable'], write: (s, n, c) => `Mint or deposit $${s} of the stable asset through ${n} on ${c}.` },
  { words: ['rwa'], write: (s, n, c) => `Mint $${s} of the protocol's yield asset on ${c} and hold it.` },
  { words: ['insurance'], write: (s, n, c) => `Buy $${s} of cover from ${n} on ${c} and keep the policy.` },
  { words: ['basis'], write: (s, n, c) => `Deposit $${s} of USDC into ${n}'s basis vault on ${c} and keep the shares.` },
  { words: ['launchpad'], write: (s, n, c) => `Commit $${s} of USDC to the next launch on ${n} and follow its allocation.` },
  { words: ['chain'], write: (s, n, c) => `Move $${s} of USDC onto the chain through ${n} and use it in one app there.` },
];

// The second move: a different action in the same protocol, so the wallet shows depth
// instead of a single deposit. It spends half the stake, at least $10.
interface SecondRule {
  words: string[];
  write: (stake: number, half: number, label: string, net: string) => string;
}

const SECOND_MOVES: SecondRule[] = [
  { words: ['lend', 'cdp', 'collateral'], write: (_s, h, n, _c) => `Borrow $${h} against the deposit on ${n}, then repay it the same week.` },
  { words: ['dex', 'leveraged farm'], write: (_s, h, n, c) => `Swap $${h} through ${n}'s pool on ${c} so the wallet also shows trading activity.` },
  { words: ['yield aggregator', 'yield', 'farm'], write: (_s, h, n, c) => `Move $${h} into a second ${n} vault on ${c} so the wallet holds two strategies.` },
  { words: ['bridge'], write: (_s, h, n, _c) => `Bridge $${h} back through ${n} so the wallet shows a round trip, not a one-way move.` },
  { words: ['staking', 'restak'], write: (_s, h, n, _c) => `Delegate $${h} of the staked receipt to a second validator through ${n}.` },
  { words: ['perpetual', 'derivative'], write: (_s, _h, n, _c) => `Close the hedge and open a fresh one on ${n} so the wallet shows repeated use.` },
  { words: ['prediction'], write: (_s, h, n, _c) => `Place a second $${h} position on a different market on ${n}.` },
  { words: ['curator', 'allocator'], write: (_s, h, n, c) => `Allocate $${h} to a second ${n} vault on ${c} and keep both shares.` },
  { words: ['stable'], write: (_s, h, n, _c) => `Swap $${h} of the stable asset for USDC through ${n} and deposit it back.` },
  { words: ['rwa'], write: (_s, h, n, _c) => `Mint $${h} of a second yield asset on ${n} and hold both.` },
  { words: ['insurance'], write: (_s, h, n, _c) => `Extend the cover by $${h} on ${n} so the policy runs longer.` },
  { words: ['basis'], write: (_s, h, n, _c) => `Add $${h} to the basis vault on ${n} in a second deposit.` },
  { words: ['launchpad'], write: (_s, _h, n, _c) => `Vote on the next launch's allocation on ${n} with the committed funds.` },
  { words: ['chain'], write: (_s, h, n, _c) => `Use $${h} in a second app on the chain ${n} serves.` },
];

// The first move for a category, or the plain deposit when nothing in the table fits.
function firstMove(cat: string, stake: number, label: string, net: string): string {
  for (const rule of FIRST_MOVES) {
    if (rule.words.some((w) => cat.includes(w))) return rule.write(stake, label, net);
  }
  return `Deposit $${stake} of USDC into ${label} on ${net} and keep the position open.`;
}

// The second move for a category, or a second deposit a week later when nothing fits.
function secondMove(cat: string, stake: number, label: string, net: string): string {
  const half = Math.max(10, Math.round(stake / 2));
  for (const rule of SECOND_MOVES) {
    if (rule.words.some((w) => cat.includes(w))) return rule.write(stake, half, label, net);
  }
  return `Make a second $${half} deposit into ${label} on ${net} a week after the first.`;
}

// A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is
// derived from the protocol's own record (category, chains, TVL, age), never from a list of
// names. Two actions in the same protocol, a weekly cadence, a hold window, a points check
// and a safe-claim step: depth a single deposit cannot show.
function planFor(e: Proto, days: number | null): PlanStep[] {
  const net = homeChain(e);
  const stake = stakeSize(e.tvl);
  const fee = txFee(net);
  const hold = holdWindow(days);
  const cat = (e.sector ?? '').toLowerCase();
  const first = firstMove(cat, stake, e.label, net);
  const second = secondMove(cat, stake, e.label, net);
  return [
    { action: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', price: 'under $3 of gas for the first transaction', span: '5 minutes' },
    { action: first, price: `$${stake} of capital and about $${fee} of gas`, span: '15 minutes to set up' },
    { action: second, price: `about $${fee} of gas`, span: '10 minutes' },
    { action: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', price: `about $${fee} of gas a week`, span: '10 minutes a week' },
    { action: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`, price: `the $${stake} stays in the position`, span: `${hold} days` },
    { action: `Open the protocol's own points or rewards page once a week and finish any quest it lists.`, price: 'no fee to check', span: '10 minutes a week' },
    { action: `Before you withdraw, claim only from the link the protocol itself publishes, and never pay to claim. Write the wallet, the dates and every transaction in a farm log.`, price: 'nothing but the log', span: '10 minutes' },
  ];
}

// A step as one string: its action, then its cost and time, within the gate's 20..600 characters.
function formatStep(step: PlanStep): string {
  let out = step.action + ' Cost: ' + step.price + '. Time: ' + step.span + '.';
  if (out.length > 600) out = out.slice(0, 596) + '...';
  if (out.length < 20) out = out + " Hold the position and check the protocol's own page.";
  return out;
}

// The protocols that already trade, richest market cap first, for the live view.
export function liveSet(snap: Snap): Array<{ slug: string; name: string; category: string | null; chains: string[]; tvl_usd: number; mcap_usd: number | null; change_7d: number | null }> {
  const trading = snap.entries.filter((e) => !hasNoToken(e) && e.sector !== 'CEX');
  trading.sort((a, b) => (b.mcap ?? 0) - (a.mcap ?? 0) || b.tvl - a.tvl);
  return trading.slice(0, LIVE_COUNT).map((e) => ({
    slug: e.id,
    name: e.label,
    category: e.sector,
    chains: e.networks,
    tvl_usd: e.tvl,
    mcap_usd: e.mcap,
    change_7d: e.weekChange,
  }));
}

type BoardLine = ReturnType<typeof rankProtocols>[number];

// A board row's compact form for data.js; the farm plan is generated in the page.
function compactRow(line: BoardLine, watchSet: Set<string>) {
  const { rank, slug, name, category, chains, tvl_usd, change_7d, mcap_usd, listed_at, age_days, implied_value_usd, model } = line;
  return {
    rank,
    slug,
    name,
    category,
    chains,
    tvl_usd,
    change_7d,
    mcap_usd,
    listed_at,
    age_days,
    implied_value_usd,
    growth_multiplier: model.growth_multiplier,
    maturity_multiplier: model.maturity_multiplier,
    size_multiplier: model.size_multiplier,
    watchlist: watchSet.has(slug),
  };
}

type RadarDoc = ReturnType<typeof assembleRadar>['radar'];

// Everything the dashboard renders, from the snapshot: the board, the live set, and the
// dials the page-side recompute runs, so the dashboard and the board can never disagree.
export function assembleRadar(snap: Snap, tune: Tuning = TUNING) {
  const board = rankProtocols(snap, tune);
  const live = liveSet(snap);
  const watchSet = new Set(snap.watch);
  let early = 0;
  for (const line of board) if (!watchSet.has(line.slug)) early++;
  const radar = {
    as_of: snap.refDate,
    source: snap.origin,
    floor_usd: snap.floor,
    model: {
      base_multiple: tune.baseMultiple,
      growth_weight: tune.growthWeight,
      growth_floor: tune.growthFloor,
      growth_cap: tune.growthCap,
      maturity_floor: tune.maturityFloor,
      maturity_range: tune.maturityRange,
      maturity_days: tune.maturityDays,
      unknown_age_days: tune.unknownAge,
      size_premium: tune.sizePremium,
    },
    model_version: RADAR_TAG,
    watchlist_size: snap.watch.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map((line) => compactRow(line, watchSet)),
    live: live,
  };
  return { board, radar };
}

// Why a snapshot file is not one this radar can score.
export class SnapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapError';
  }
}

// Read the snapshot out of a file's text, refusing anything that is not the shape the
// radar scores. Fields the snapshot does not carry come back null or empty, never guessed.
export function readSnapshot(text: string): Snap {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapError('snapshot text is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapError('snapshot text is not a JSON object');
  }
  const doc = raw as Record<string, unknown>;
  const refDate = doc['as_of'];
  if (typeof refDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(refDate)) {
    throw new SnapError('snapshot has no as_of date');
  }
  const origin = doc['source'];
  if (typeof origin !== 'string') throw new SnapError('snapshot has no source');
  const floor = doc['floor_usd'];
  if (typeof floor !== 'number' || !Number.isSafeInteger(floor) || floor <= 0) {
    throw new SnapError('snapshot has no floor_usd');
  }
  const rawEntries = doc['protocols'];
  if (!Array.isArray(rawEntries)) throw new SnapError('snapshot has no protocols array');
  const rawWatch = doc['watchlist'];
  if (!Array.isArray(rawWatch) || rawWatch.some((s) => typeof s !== 'string')) {
    throw new SnapError('snapshot has no watchlist of slugs');
  }
  const entries = rawEntries.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      throw new SnapError(`snapshot protocol ${i} is not an object`);
    }
    const p = v as Record<string, unknown>;
    const id = p['slug'];
    const label = p['name'];
    const tvlRaw = p['tvl_usd'];
    if (typeof id !== 'string' || typeof label !== 'string' || typeof tvlRaw !== 'number' || !Number.isFinite(tvlRaw)) {
      throw new SnapError(`snapshot protocol ${i} lacks a slug, a name or a TVL`);
    }
    const sector = p['category'];
    const nets = p['chains'];
    const weekRaw = p['change_7d'];
    const mcapRaw = p['mcap_usd'];
    const listedRaw = p['listed_at'];
    const geckoRaw = p['gecko_id'];
    const tickerRaw = p['symbol'];
    return {
      id,
      label,
      sector: typeof sector === 'string' ? sector : null,
      networks: Array.isArray(nets) ? nets.filter((c): c is string => typeof c === 'string') : [],
      tvl: tvlRaw,
      weekChange: typeof weekRaw === 'number' && Number.isFinite(weekRaw) ? weekRaw : null,
      mcap: typeof mcapRaw === 'number' && Number.isFinite(mcapRaw) ? mcapRaw : null,
      listed: typeof listedRaw === 'string' ? listedRaw : null,
      gecko: typeof geckoRaw === 'string' ? geckoRaw : null,
      ticker: typeof tickerRaw === 'string' ? tickerRaw : null,
    };
  });
  return { refDate, origin, floor, entries, watch: rawWatch as string[] };
}

// Why a board is not one the gate will take, or null: coverage, ranks, order, one shared
// implied value, and farm steps.
export function validateBoard(board: BoardLine[], snap: Snap): string | null {
  const have = new Set(board.map((line) => line.slug));
  const missing = snap.watch.filter((id) => !have.has(id));
  if (missing.length > 0) {
    return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  }
  const places = board.map((line) => line.rank).sort((a, b) => a - b);
  for (let i = 0; i < places.length; i++) {
    if (places[i] !== i + 1) return `rank ${i + 1} is ${places[i]}`;
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const line of board) {
    if (line.farm_steps.length < 3 || line.farm_steps.length > 12) return `${line.slug} has ${line.farm_steps.length} farm steps`;
    for (const s of line.farm_steps) {
      if (s.length < 20 || s.length > 600) return `${line.slug} has a farm step of ${s.length} characters`;
    }
    if (!Number.isSafeInteger(line.implied_value_usd) || line.implied_value_usd <= 0) {
      return `${line.slug} has implied value ${line.implied_value_usd}`;
    }
  }
  return null;
}

// The dashboard's whole dataset as one script: no fetch and no network.
export function radarScript(radar: RadarDoc): string {
  return 'window.RADAR=' + JSON.stringify(radar) + ';\n';
}
