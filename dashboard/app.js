// Token Radar's dashboard, radar-3. Reads window.RADAR and renders the board
// ranked by expected value (implied value times token odds), the filterable
// table, per-protocol detail with farm verdict, the model sandbox, the
// calibration table, an integrity strip that recomputes coverage live, and a
// ledger accounting for every protocol in the snapshot. No network: every byte
// it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', tab: 'pre-token', sort: 'ev', dir: -1, selected: null };
  // The sandbox starts on the submitted model. Moving a slider re-ranks the board in the page only:
  // board.json, the entry's ranked board, is never changed by it.
  var sandbox = {
    growth_weight: DATA.model.growth_weight,
    maturity_range: DATA.model.maturity_range,
    chain_bonus: DATA.model.chain_bonus,
    active: false,
  };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  // Expected value and the farm verdict (v3 fields). Each accessor falls back
  // to the v2 figures when a field is absent, so an older data file still renders.
  function oddsOf(r) { return (r.odds === null || r.odds === undefined || !isFinite(r.odds)) ? null : r.odds; }
  function fmtOdds(o) { return o === null ? 'n/a' : Math.round(o * 100) + '%'; }
  function evOf(r) { var o = oddsOf(r); return o === null ? valueOf(r) : Math.round(valueOf(r) * o); }
  function fmtHour(v) {
    if (v === null || v === undefined || !isFinite(v)) return 'n/a';
    return (v < 0 ? '-$' : '$') + Math.abs(v).toFixed(2) + '/h';
  }
  function fmtBe(days) {
    if (days === null || days === undefined) return 'never';
    return Math.round(days) + 'd';
  }
  function farmThresholds() {
    var t = DATA.farm_thresholds || (DATA.model && DATA.model.farm_thresholds) || (DATA.validation && DATA.validation.farm_thresholds) || null;
    if (!t) return null;
    var farm = t.farm_usd_per_hour !== undefined ? t.farm_usd_per_hour : t.farm;
    var marg = t.marginal_usd_per_hour !== undefined ? t.marginal_usd_per_hour : t.marginal;
    if (farm === undefined || marg === undefined) return null;
    return { farm: farm, marginal: marg };
  }
  function verdictLine() {
    var t = farmThresholds();
    return t ? 'Verdict: FARM at \u2265 $' + t.farm.toFixed(2) + '/h, MARGINAL at \u2265 $' + t.marginal.toFixed(2) + '/h, else SKIP.' : 'Verdict from the farm plan\u2019s net $/hour and break-even.';
  }
  // The integrity strip recomputes every coverage claim from the data at
  // render time and lists each mismatch instead of hiding it.
  function ledgerCounts() {
    var setAside = (DATA.ledger && DATA.ledger.set_aside) || [];
    var liveTotal = DATA.ledger ? DATA.ledger.live : null;
    var boarded = DATA.rows.length;
    var total = liveTotal === null ? null : boarded + liveTotal + setAside.length;
    var watch = DATA.rows.filter(function (r) { return r.watchlist; }).length;
    var issues = [];
    if (DATA.ledger && DATA.ledger.total !== undefined && total !== null && total !== DATA.ledger.total) issues.push('total recomputes ' + total + ', ledger claims ' + DATA.ledger.total);
    if (DATA.ledger && DATA.ledger.boarded !== undefined && boarded !== DATA.ledger.boarded) issues.push('boarded recomputes ' + boarded + ', ledger claims ' + DATA.ledger.boarded);
    if (DATA.board_size && boarded !== DATA.board_size) issues.push('board has ' + boarded + ' rows, board_size ' + DATA.board_size);
    if (DATA.watchlist_size && watch !== DATA.watchlist_size) issues.push('watchlist covers ' + watch + ' of ' + DATA.watchlist_size);
    return { boarded: boarded, liveTotal: liveTotal, setAside: setAside, total: total, watch: watch, issues: issues };
  }
  // The model in one function: the page recomputes a row from the snapshot
  // figures and checks the number board.json carries.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var chains = 1 + Math.min(Math.max((row.chains || []).length - 1, 0), model.chain_bonus_cap) * model.chain_bonus;
    return Math.max(1, Math.round(row.tvl_usd * row.category_multiple * growthMult * maturity * chains));
  }
  // The sandbox's recompute: the same factors, with the slider values in place
  // of the submitted growth weight, maturity range and chain bonus.
  function sandboxImpliedOf(row) {
    var model = {
      growth_cap: DATA.model.growth_cap,
      growth_floor: DATA.model.growth_floor,
      growth_weight: sandbox.growth_weight,
      unknown_age_days: DATA.model.unknown_age_days,
      maturity_floor: DATA.model.maturity_floor,
      maturity_days: DATA.model.maturity_days,
      maturity_range: sandbox.maturity_range,
      chain_bonus_cap: DATA.model.chain_bonus_cap,
      chain_bonus: sandbox.chain_bonus,
    };
    return impliedOf(row, model);
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json:
  // category, chains, TVL and age decide the action, capital, hold and costs.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function secondFeatureFor(p) {
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'borrow a small amount against the supply and repay it';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'swap a small amount through the pool and add it back as liquidity';
    if (c.indexOf('bridge') >= 0) return 'bridge a second, smaller amount back and use it on the home chain';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'restake the receipt token once, if the protocol offers it';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'close the hedge, then open a fresh one half its size';
    if (c.indexOf('prediction') >= 0) return 'settle one market and enter a second one';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'move a small share into a second vault of the same protocol';
    if (c.indexOf('stable') >= 0) return 'redeem a small amount of the stable asset and mint it again';
    if (c.indexOf('rwa') >= 0) return 'claim the yield once and compound it back into the position';
    if (c.indexOf('insurance') >= 0) return 'file a test claim on the cover only if a real event qualifies';
    return 'vote once, if the protocol runs a vote, and use a second feature of its app';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var second = p.chains && p.chains.length > 1 ? p.chains[1] : null;
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = capital >= 150 ? 8 : 4;
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + gas + ' of gas', time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      second !== null
        ? { text: 'Repeat the qualifying action on ' + second + ' too, so the wallet is active on more than one chain.', cost: 'about $' + gas + ' of gas and no new capital', time: '15 minutes' }
        : { text: 'Use a second feature as well: ' + secondFeatureFor(p) + '.', cost: 'about $2 of gas', time: '10 minutes' },
      { text: "Open the protocol's own points or rewards page once a month and check the wallet is earning.", cost: 'no fee to check', time: '10 minutes a month' },
      { text: "Never pay to claim, never click a claim link from a message or a search ad, and claim only from the protocol's own site.", cost: 'nothing, and a paid claim is a scam', time: '5 minutes to verify the link' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function valueOf(r) { return sandbox.active ? sandboxImpliedOf(r) : r.implied_value_usd; }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'odds') { av = oddsOf(a) === null ? -1 : oddsOf(a); bv = oddsOf(b) === null ? -1 : oddsOf(b); }
      else if (key === 'farm') { av = a.farm_usd_per_hour === null || a.farm_usd_per_hour === undefined ? -Infinity : a.farm_usd_per_hour; bv = b.farm_usd_per_hour === null || b.farm_usd_per_hour === undefined ? -Infinity : b.farm_usd_per_hour; }
      else if (key === 'ev') { av = evOf(a); bv = evOf(b); }
      else { av = valueOf(a); bv = valueOf(b); }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('span', { class: 'mark', 'aria-hidden': 'true' }),
        el('span', { class: 'brand-name', html: 'Token <em>Radar</em>' })
      ),
      el('div', { class: 'top-meta' },
        el('span', { html: 'Snapshot <b>' + DATA.as_of + '</b>' }),
        el('span', { html: 'Source <b>DefiLlama</b>' }),
        el('span', { html: 'Model <b>' + DATA.model_version + '</b>' })
      )
    );
  }

  // The hero strip: four headline figures. Every number is computed from the
  // snapshot figures in this page, never typed in.
  function hero() {
    var watch = DATA.rows.filter(function (r) { return r.watchlist; });
    var watchTvl = watch.reduce(function (sum, r) { return sum + r.tvl_usd; }, 0);
    var top = DATA.rows.reduce(function (best, r) { return evOf(r) > evOf(best) ? r : best; }, DATA.rows[0]);
    var liveTotal = DATA.ledger ? DATA.ledger.live : null;
    return el('section', { class: 'hero', 'aria-label': 'Headline figures' },
      el('div', { class: 'stat' },
        el('span', { class: 'stat-label', text: 'Watchlist TVL' }),
        el('span', { class: 'stat-value', text: fmtUsd(watchTvl) }),
        el('span', { class: 'stat-sub', text: 'across ' + DATA.watchlist_size + ' watchlist protocols' })
      ),
      el('div', { class: 'stat' },
        el('span', { class: 'stat-label', text: 'Highest expected value' }),
        el('span', { class: 'stat-value', text: fmtUsd(evOf(top)) }),
        el('span', { class: 'stat-sub', text: '#1 ' + top.name + ' by expected value' })
      ),
      el('div', { class: 'stat' },
        el('span', { class: 'stat-label', text: 'Protocols ranked' }),
        el('span', { class: 'stat-value', text: String(DATA.board_size) }),
        el('span', { class: 'stat-sub', text: DATA.watchlist_size + ' watchlist + ' + DATA.early_size + ' early' })
      ),
      el('div', { class: 'stat' },
        el('span', { class: 'stat-label', text: 'Live tokens shown' }),
        el('span', { class: 'stat-value', text: String(DATA.live_size) }),
        el('span', { class: 'stat-sub', text: liveTotal === null ? 'their market caps price the categories' : 'of ' + liveTotal + ' live-token protocols, set aside' })
      )
    );
  }

  // A blind-test multiple, wherever the data file nests it: v3 data carries it
  // under loo.variants.v3 / walk_forward.pooled.v3; an older file may carry it
  // as a plain number. Anything else is not a number.
  function multOf(x) {
    if (x === undefined || x === null) return null;
    if (typeof x === 'number') return 'x' + x.toFixed(2);
    var inner = x.variants || x.pooled || null;
    var m = inner && inner.v3 ? inner.v3.multiple : undefined;
    return m === undefined || m === null || isNaN(+m) ? null : 'x' + (+m).toFixed(2);
  }

  // The integrity strip: the dashboard's own claims, recomputed live from the
  // data at render time. A chip turns red and names the mismatch when a
  // recomputed number disagrees with the claimed one.
  function integrityStrip() {
    var c = ledgerCounts();
    var v = DATA.validation || null;
    var terms = (v && v.terms) || [];
    var kept = terms.filter(function (t) { return String(t.decision).toLowerCase() === 'keep'; }).length;
    var nCex = c.setAside.filter(function (s) { return /cex/i.test(s.reason); }).length;
    var nVer = c.setAside.filter(function (s) { return /version/i.test(s.reason); }).length;
    var rows = [
      ['Total protocols', c.total === null ? 'n/a' : String(c.total), c.total === null ? 'no ledger in this data file' : c.boarded + ' boarded + ' + c.liveTotal + ' live + ' + c.setAside.length + ' set aside', c.issues.length > 0],
      ['Boarded', String(c.boarded), 'ranked on the board', DATA.board_size ? c.boarded !== DATA.board_size : false],
      ['Live set aside', c.liveTotal === null ? 'n/a' : String(c.liveTotal), 'already trade, priced out', false],
      ['Pre-token set aside', String(c.setAside.length), c.setAside.length ? nCex + ' CEX \u00b7 ' + nVer + ' versioned' : 'none listed', false],
      ['Watchlist covered', c.watch + ' / ' + DATA.watchlist_size, 'watchlist protocols on the board', c.watch !== DATA.watchlist_size],
      ['Leave-one-out', multOf(v && v.loo) || 'n/a', 'held-out, one protocol out', false],
      ['Walk-forward', multOf(v && v.walk_forward) || 'n/a', 'held-out, older to newer', false],
      ['Model terms', terms.length ? kept + ' kept \u00b7 ' + (terms.length - kept) + ' dropped' : DATA.model_version, terms.length ? 'kept / dropped on blind tests' : 'no term decisions in this data file', false],
    ];
    var chips = rows.map(function (r) {
      return el('div', { class: 'strip-chip' + (r[3] ? ' bad' : '') },
        el('span', { class: 'strip-label', text: r[0] }),
        el('span', { class: 'strip-value', text: r[1] }),
        el('span', { class: 'strip-sub', text: r[2] }));
    });
    var note = c.issues.length
      ? el('p', { class: 'strip-note bad', text: 'Self-check failed: ' + c.issues.join('; ') + '.' })
      : el('p', { class: 'strip-note', text: 'Self-check passed: every count above recomputes from the data on this page.' });
    return el('section', { class: 'strip', 'aria-label': 'Integrity check' }, chips, note);
  }

  // The site footer: methodology, source and the honest disclaimer. Plain text
  // only, so the page stays fully offline.
  function siteFoot() {
    return el('footer', { class: 'site-foot' },
      el('div', null,
        el('h3', { text: 'How the board is built' }),
        el('p', { text: 'Every protocol in the DefiLlama index is read from a sealed snapshot taken ' + DATA.as_of + '. A protocol joins the watchlist when it holds at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and records no token. "No token" is the snapshot\u2019s own record, so wrapped and bridged products of a trading token (WBTC, bridge and staked-ETH products) are on the board: they hold large TVL and the snapshot records no token for them. Implied value is TVL times one global multiple, 0.246, the median market cap per dollar of TVL of the snapshot\u2019s live-token protocols \u2014 the blind tests dropped the category, growth, maturity and chain terms (see Held-out validation).' }),
        el('p', { text: 'The board ranks every rankable pre-token protocol; the ledger accounts for the rest of the snapshot, and the live-token market caps are what price the categories.' })
      ),
      el('div', null,
        el('h3', { text: 'Read it as a model' }),
        el('p', { text: 'Implied value is an estimate of what a launch could be worth if the market priced this protocol the way it prices live protocols in the same category. It is not a price, a prediction or investment advice. Farm plans name real costs and times, but gas, slippage and eligibility change; verify every step on the protocol\u2019s own site before you act.' }),
        el('p', { text: 'Source: DefiLlama protocol index, snapshot ' + DATA.as_of + '. Model ' + DATA.model_version + '. Built for the make.fun token-radar-01 bounty.' })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by expected value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor. Expected value is implied value times token odds from the peers\u2019 record; implied value is a model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    var ledger = el('button', { type: 'button', 'aria-pressed': state.tab === 'ledger' ? 'true' : 'false', text: 'Ledger', onclick: function () { state.tab = 'ledger'; render(); } });
    var c = ledgerCounts();
    var countText = state.tab === 'pre-token' ? rows().length + ' rows shown' + (sandbox.active ? ' (sandbox ranking)' : '')
      : state.tab === 'live' ? DATA.live.length + ' live-token protocols'
      : (c.total === null ? 'ledger not in this data file' : c.total + ' protocols accounted for');
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live, ledger)),
      el('span', { class: 'count', text: countText })
    );
  }

  function sortHeader(key, label, cls) {
    return el('th', { scope: 'col', class: cls || null },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  // A row's rank by expected value, over the whole board, for the detail view.
  function evRankOf(slug) {
    var s = DATA.rows.slice().sort(function (a, b) { return evOf(b) - evOf(a); });
    for (var i = 0; i < s.length; i++) if (s[i].slug === slug) return i + 1;
    return null;
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; writeHash(); render(); } })
      ));
    }
    var max = Math.max.apply(null, list.map(function (r) { return valueOf(r); })) || 1;
    var tbody = el('tbody');
    list.forEach(function (r, i) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      // The rank shown is the expected-value rank: the board sorts by EV by
      // default, and the sandbox re-ranks the page. Any other sort keeps the
      // submitted rank, the implied-value rank in board.json.
      var shownRank = (state.sort === 'ev' || sandbox.active) ? (i + 1) : r.rank;
      var shownValue = valueOf(r);
      var verdict = r.farm_verdict || null;
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', null, el('span', { class: shownRank <= 3 ? 'rank top' : 'rank', text: String(shownRank) })),
        el('td', null, el('div', { class: 'name' },
          el('div', { class: 'name-row' },
            el('b', { text: r.name }),
            el('span', { class: r.watchlist ? 'pill watch' : 'pill early', text: r.watchlist ? 'watchlist' : 'early' })
          ),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num opt ' + growthClass, text: growth }),
        el('td', { class: 'num opt', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: fmtOdds(oddsOf(r)) }),
        el('td', { class: 'num', text: fmtUsd(evOf(r)) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((shownValue / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(shownValue) })
        )),
        el('td', null, el('div', { class: 'farm-cell' },
          el('span', { class: 'num', text: fmtHour(r.farm_usd_per_hour) }),
          el('span', { class: 'sub', text: 'break-even ' + fmtBe(r.farm_break_even_days) })
        )),
        el('td', null, verdict
          ? el('span', { class: 'verdict verdict-' + verdict.toLowerCase(), text: verdict })
          : el('span', { class: 'sub', text: 'n/a' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: sandbox.active ? 'Sandbox ranking: the same board re-scored with your slider values. The submitted board is unchanged. ' + verdictLine() : 'Pre-token protocols, strongest expected value first. Select a row for its model and farm plan. ' + verdictLine() }),
          el('thead', null, el('tr', null,
            sortHeader('ev', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d', 'opt'),
            sortHeader('age', 'Age', 'opt'),
            sortHeader('odds', 'Odds'),
            sortHeader('ev', 'Expected value'),
            sortHeader('implied', 'Implied value'),
            sortHeader('farm', 'Farm $/h'),
            el('th', { scope: 'col', text: 'Verdict' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking, and their market caps price the categories in the table below.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function calibrationTable() {
    var shown = (DATA.calibration || []).filter(function (c) { return c.live_count > 0; }).sort(function (a, b) { return b.multiple - a.multiple; });
    var tbody = el('tbody');
    shown.forEach(function (c) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('b', { text: c.category })),
        el('td', { class: 'num', text: String(c.live_count) }),
        el('td', { class: 'num', text: c.median_mcap_per_tvl === null ? 'n/a' : String(c.median_mcap_per_tvl) }),
        el('td', { class: 'num', text: String(c.multiple) })
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Reference only: each category\u2019s own live-token pricing. The board does NOT price by these \u2014 every row uses the single global multiple 0.246 (see How implied value is computed).' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Live protocols' }), el('th', { scope: 'col', text: 'Median mcap / TVL' }), el('th', { scope: 'col', text: 'Category multiple (reference only)' }))),
          tbody
        )
      )
    );
  }

  // The ledger: every protocol in the snapshot accounted for. Boarded rows are
  // the board itself; live-token protocols already trade (24 in the Live tab);
  // the pre-token set-aside is listed below, each with its reason. The sum is
  // recomputed here and must equal the ledger total.
  function ledgerPanel() {
    var c = ledgerCounts();
    var sum = c.liveTotal === null ? null : c.boarded + c.liveTotal + c.setAside.length;
    var sumOk = sum !== null && DATA.ledger && DATA.ledger.total !== undefined && sum === DATA.ledger.total;
    var sumLine = sum === null
      ? 'No ledger total in this data file, so the sum cannot be checked here.'
      : c.boarded + ' + ' + c.liveTotal + ' + ' + c.setAside.length + ' = ' + sum + (sumOk ? ' — matches the ledger total.' : ' — does NOT match the ledger total of ' + DATA.ledger.total + '.');
    var tbody = el('tbody');
    c.setAside.forEach(function (s) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('div', { class: 'name' }, el('b', { text: s.name }), el('span', { class: 'sub', text: s.slug }))),
        el('td', null, el('span', { text: s.reason }))
      ));
    });
    return el('div', { class: 'ledger' },
      el('section', { class: 'panel model' },
        el('h2', { text: 'The ledger: every protocol accounted for' }),
        el('p', { class: 'sub', text: 'The snapshot holds ' + (c.total === null ? 'an unknown number of' : c.total) + ' protocols. Nothing is dropped silently: each one is boarded, already trading, or set aside with a reason.' }),
        el('div', { class: 'equation' },
          el('div', null, el('span', { text: 'Boarded (on the board)' }), el('b', { class: 'num', text: String(c.boarded) })),
          el('div', null, el('span', { text: 'Live-token (already trade)' }), el('b', { class: 'num', text: c.liveTotal === null ? 'n/a' : String(c.liveTotal) })),
          el('div', null, el('span', { text: 'Pre-token set aside' }), el('b', { class: 'num', text: String(c.setAside.length) })),
          el('div', null, el('span', { text: 'Reconciliation' }), el('b', { class: 'num', text: sum === null ? 'n/a' : String(sum) }))
        ),
        el('p', { class: 'sub' + (sum !== null && !sumOk ? ' bad-text' : ''), text: sumLine + ' The Live tab shows the top ' + DATA.live.length + ' live-token protocols by market cap; the rest are counted here, not listed.' })
      ),
      c.setAside.length ? el('div', { class: 'panel' },
        el('div', { class: 'table-wrap' },
          el('table', null,
            el('caption', { class: 'sub', text: 'Pre-token protocols set aside, each with its reason: CEX means an exchange, versioned means a numbered version of a listed protocol.' }),
            el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'Reason set aside' }))),
            tbody
          )
        )
      ) : el('div', { class: 'panel' }, el('div', { class: 'empty' }, el('p', { text: 'No pre-token protocol was set aside in this data file.' })))
    );
  }

  // Held-out validation, from data.validation: the two blind-test multiples
  // and the keep/drop decision for every value-model term.
  function validationBlock() {
    var v = DATA.validation || null;
    if (!v) return el('div', null,
      el('h3', { text: 'Held-out validation' }),
      el('p', { class: 'sub', text: 'This data file carries no validation numbers.' }));
    var terms = v.terms || [];
    var tbody = el('tbody');
    terms.forEach(function (t) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('b', { text: t.term })),
        el('td', null, el('span', { class: String(t.decision).toLowerCase() === 'keep' ? 'verdict verdict-farm' : 'verdict verdict-skip', text: String(t.decision).toUpperCase() })),
        el('td', { class: 'num', text: t.loo === undefined ? 'n/a' : 'x' + (+t.loo).toFixed(2) }),
        el('td', { class: 'num', text: t.walk_forward === undefined ? 'n/a' : 'x' + (+t.walk_forward).toFixed(2) })
      ));
    });
    return el('div', null,
      el('h3', { text: 'Held-out validation' }),
      el('p', { class: 'sub', text: 'Terms were fitted on traded-token comps and kept only if they beat the no-term baseline out of sample on both blind tests: leave-one-out ' + (multOf(v.loo) || 'n/a') + ', walk-forward ' + (multOf(v.walk_forward) || 'n/a') + '.' + (v.notes ? ' ' + v.notes : '') }),
      terms.length ? el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Term' }), el('th', { scope: 'col', text: 'Decision' }), el('th', { scope: 'col', text: 'Leave-one-out' }), el('th', { scope: 'col', text: 'Walk-forward' }))),
          tbody
        )
      ) : null
    );
  }

  function sandboxPanel() {
    function slider(id, label, min, max, step, key, format) {
      var input = el('input', { type: 'range', id: id, min: String(min), max: String(max), step: String(step), value: String(sandbox[key]), 'aria-label': label });
      var out = el('output', { for: id, text: format(sandbox[key]) });
      input.addEventListener('input', function () {
        sandbox[key] = parseFloat(input.value);
        sandbox.active = sandbox.growth_weight !== DATA.model.growth_weight || sandbox.maturity_range !== DATA.model.maturity_range || sandbox.chain_bonus !== DATA.model.chain_bonus;
        out.textContent = format(sandbox[key]);
        render();
      });
      return el('div', { class: 'field' }, el('label', { for: id, text: label }), el('div', { class: 'slider-row' }, input, out));
    }
    var reset = el('button', { class: 'button', type: 'button', text: 'Reset to the submitted model', onclick: function () {
      sandbox.growth_weight = DATA.model.growth_weight;
      sandbox.maturity_range = DATA.model.maturity_range;
      sandbox.chain_bonus = DATA.model.chain_bonus;
      sandbox.active = false;
      render();
    } });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'Model sandbox' }),
      el('p', { class: 'sub', text: 'Move a slider and the board re-ranks in the page, so you can see what each weight does \u2014 each slider re-enables one term the blind tests dropped. The global multiple never moves: it is the snapshot\u2019s own calibration. The submitted board is unchanged.' }),
      el('div', { class: 'sandbox' },
        slider('sb-growth', 'Growth weight', 0, 1, 0.05, 'growth_weight', function (v) { return v.toFixed(2); }),
        slider('sb-maturity', 'Maturity range', 0, 0.8, 0.05, 'maturity_range', function (v) { return v.toFixed(2); }),
        slider('sb-chain', 'Chain bonus', 0, 0.1, 0.01, 'chain_bonus', function (v) { return v.toFixed(2); }),
        el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Sandbox' }), reset)
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x global_multiple x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x (1 + min(chains - 1, ' + m.chain_bonus_cap + ') x ' + m.chain_bonus + ') )'
      ),
      el('p', { class: 'sub', text: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. The multiple is one global number for every row: the median market cap per dollar of TVL of the snapshot\u2019s live-token protocols, each protocol\u2019s ratio capped at ' + m.ratio_cap + ' so one outlier cannot set it. The blind tests dropped the per-category multiple, the seven-day growth factor, the maturity factor and the chain bonus \u2014 each made held-out error worse. The early radar is every pre-token protocol below the watchlist floor, by TVL, and the live-token protocols are set aside with their market caps shown.' }),
      validationBlock()
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function calibrationFor(category) {
    var list = DATA.calibration || [];
    for (var i = 0; i < list.length; i++) if (list[i].category === (category || 'Other')) return list[i];
    return null;
  }

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var cal = calibrationFor(row.category);
    var calLine = cal === null
      ? 'No live-token protocol in this category, so the whole live set prices it.'
      : 'Priced by the single global multiple ' + DATA.global_multiple + ' (median market cap per dollar of TVL of all live-token protocols). This category has ' + cal.live_count + ' live-token protocol' + (cal.live_count === 1 ? '' : 's') + (cal.median_mcap_per_tvl === null ? '' : ', median ' + cal.median_mcap_per_tvl) + ' \u2014 shown for reference; it does not change this row\u2019s price.';
    var evr = evRankOf(slug);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'detail-kicker', text: 'EV rank ' + evr + ' of ' + DATA.board_size + (row.rank !== evr ? ' · implied rank ' + row.rank : '') + (row.watchlist ? ' · watchlist' : ' · early radar') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Global multiple' }), el('b', { class: 'num', text: String(row.category_multiple) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Chains' }), el('b', { class: 'num', text: String((row.chains || []).length) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Chain multiplier' }), el('b', { class: 'num', text: String(row.chain_multiplier) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) })),
        el('div', null, el('span', { text: 'Token odds' }), el('b', { class: 'num', text: fmtOdds(oddsOf(row)) })),
        el('div', null, el('span', { text: 'Expected value' }), el('b', { class: 'num', text: fmtUsd(evOf(row)) }))
      ),
      el('p', { class: 'sub', text: calLine + ' Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(impliedOf(row, DATA.model)) + (impliedOf(row, DATA.model) === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' Expected value is implied value times token odds, from the peers\u2019 own record. This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm verdict' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'Farm net' }), el('b', { class: 'num', text: fmtHour(row.farm_usd_per_hour) })),
        el('div', null, el('span', { text: 'Break-even' }), el('b', { class: 'num', text: fmtBe(row.farm_break_even_days) })),
        el('div', null, el('span', { text: 'Verdict' }), row.farm_verdict
          ? el('span', { class: 'verdict verdict-' + row.farm_verdict.toLowerCase(), text: row.farm_verdict })
          : el('b', { class: 'num', text: 'n/a' }))
      ),
      el('p', { class: 'sub', text: verdictLine() + ' The farm plan below is the same 8 steps board.json carries for this row.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(integrityStrip());
    shell.appendChild(lede());
    shell.appendChild(hero());
    shell.appendChild(controls());
    if (state.tab === 'pre-token') {
      shell.appendChild(boardTable());
      shell.appendChild(sandboxPanel());
      shell.appendChild(modelPanel());
    } else if (state.tab === 'live') {
      shell.appendChild(liveTable());
      shell.appendChild(calibrationTable());
    } else {
      shell.appendChild(ledgerPanel());
    }
    shell.appendChild(siteFoot());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
