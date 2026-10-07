/**
 * NFL Matchup Analyzer - page logic.
 *
 * Summary:
 *   Loads the weekly snapshot list (data/weeks.json), then the chosen week's
 *   snapshot, and builds the page: game header and final result, a game
 *   script (where each offense should excel or struggle, with backtested
 *   confidence labels, fantasy angles, pace, and game flow), key injuries
 *   (injured starters, who's next up, and fantasy notes), betting
 *   lines and line movement, a composite EPA projection for each offense,
 *   context (Pythagorean record, pace, rest, roof), and two stat-by-stat
 *   tables (away offense vs home defense, home offense vs away defense).
 *   A separate "League rankings" view lists every team's offense, defense,
 *   and net EPA per play (plus strength of schedule) in a sortable table.
 *   A Raw / Opponent-adjusted toggle switches the stat tables and rankings
 *   to stats adjusted for the opponents each team has faced; the composite
 *   box always shows both. The game script always uses raw stats.
 *   A "Weekly overview" view lists every game of the week with lines, raw and
 *   opponent-adjusted composites, estimated spreads, underdog flags, and
 *   results in a sortable table, plus injury tags per team; tapping a game
 *   opens it in the Matchup view.
 *
 *   Ranks in the data always mean "1 = best for that side": for a defense,
 *   best means allowed the least, except sacks, QB hits, and turnovers, where
 *   1 = forced the most. So in every row the smaller rank number has the edge.
 *
 * Input files (fetched from the same site):
 *   data/weeks.json           - Index of available weeks.
 *   data/<season>_week_NN.json - One snapshot per week (made by nfl_team_stats.py).
 * Output files: None. Everything is rendered into index.html.
 *
 * Location: D:\OneDrive\Code\DFS_direct\NFL\nfl-matchups\app.js
 */

// ----------------------------------------------------------------------
// Settings you can change
// ----------------------------------------------------------------------
const BIG_EDGE_GAP = 8;          // Rank gap that counts as a big edge (highlighted)
const TOP_TIER = 10;             // Both ranks this good or better = "strength vs strength"
const BOTTOM_TIER = 23;          // Ranks this bad or worse are shown in red
const SMALL_SAMPLE_WEEKS = 4;    // Fewer weeks of stats than this = stronger warning

const STATS = [
  { key: 'epa_per_play', label: 'EPA per play', fmt: 'epa',
    help: 'Expected points added per play: how much each play changed the expected score. The best all-in-one efficiency stat.' },
  { key: 'success_rate', label: 'Success rate', fmt: 'pct',
    help: 'Share of plays with positive EPA (plays that left the offense better off).' },
  { key: 'pass_epa', label: 'Pass EPA', fmt: 'epa', help: 'EPA per pass play (sacks included).' },
  { key: 'rush_epa', label: 'Rush EPA', fmt: 'epa', help: 'EPA per run play.' },
  { key: 'pass_success', label: 'Pass success', fmt: 'pct', help: 'Success rate on pass plays.' },
  { key: 'rush_success', label: 'Rush success', fmt: 'pct', help: 'Success rate on run plays.' },
  { key: 'early_down_epa', label: 'Early-down EPA', fmt: 'epa',
    help: 'EPA per play on 1st and 2nd down, which predicts future results better than 3rd-down play.' },
  { key: 'explosive_rate', label: 'Explosive rate', fmt: 'pct', help: 'Share of plays that were a 20+ yard pass or a 10+ yard run.' },
  { key: 'yards_per_play', label: 'Yards per play', fmt: 'ypp', help: 'Average yards gained per play.' },
  { key: 'third_down_conv', label: '3rd-down conv.', fmt: 'pct', help: 'Share of 3rd-down plays that gained a first down.' },
  { key: 'red_zone_epa', label: 'Red zone EPA', fmt: 'epa', help: 'EPA per play inside the opponent\'s 20-yard line.' },
  { key: 'sack_rate', label: 'Sack rate', fmt: 'pct',
    help: 'Sacks per pass play. Offense rank 1 = fewest taken; defense rank 1 = most made.' },
  { key: 'qb_hit_rate', label: 'QB hit rate', fmt: 'pct',
    help: 'QB hits per pass play. Offense rank 1 = fewest taken; defense rank 1 = most made.' },
  { key: 'cpoe', label: 'CPOE', fmt: 'cpoe',
    help: 'Completion percentage over expected, in percentage points: how much more often passes are completed than their difficulty predicts.' },
  { key: 'turnover_rate', label: 'Turnover rate', fmt: 'pct',
    help: 'Interceptions plus lost fumbles per play. Offense rank 1 = fewest; defense rank 1 = most forced.' },
];

// Game script areas. A matchup score averages, for each listed stat, how far the
// offense and the opposing defense are from league average (in standard
// deviations), signed so positive = the offense should excel. Thresholds and hit
// rates must match the latest run of nfl_game_script_backtest.py.
const SCRIPT_AREAS = [
  {
    label: 'Passing', stats: ['pass_epa', 'pass_success'], sign: 1,
    lean: 0.5, leanHit: 63, strong: 1.0, strongHit: 73,
    excel: 'should move the ball efficiently through the air',
    struggle: 'may have trouble passing efficiently',
    fantasyExcel: 'QB, WR and TE upgrade', fantasyStruggle: 'QB, WR and TE downgrade',
  },
  {
    label: 'Pass protection', stats: ['sack_rate', 'qb_hit_rate'], sign: -1,
    lean: 0.5, leanHit: 62, strong: 1.0, strongHit: 69,
    excel: 'QB should stay mostly clean',
    struggle: 'QB likely to take sacks and hits',
    fantasyExcel: 'QB upgrade (clean pocket)', fantasyStruggle: 'QB downgrade; {def} defense/DST upgrade (sacks)',
  },
  {
    label: 'Running', stats: ['rush_epa', 'rush_success'], sign: 1,
    lean: 0.75, leanHit: 62, strong: 1.0, strongHit: 68,
    excel: 'should run the ball well',
    struggle: 'may struggle to run the ball',
    fantasyExcel: 'RB upgrade', fantasyStruggle: 'RB downgrade',
  },
  {
    label: 'Explosive plays', stats: ['explosive_rate'], sign: 1,
    lean: null, leanHit: null, strong: 1.0, strongHit: 67,
    excel: 'good chance of big plays (20+ yard passes, 10+ yard runs)',
    struggle: 'big plays likely hard to come by',
    fantasyExcel: 'boom potential for deep threats and big-play backs', fantasyStruggle: 'lower ceilings for big-play receivers',
  },
];
const PACE_TAIL = 0.10;         // Mention pace when a matchup is in the fastest/slowest 10% of possible pairings
const PACE_FAST_HIT = 64;       // % of fast-projected games that actually ran above average
const PACE_SLOW_HIT = 71;       // % of slow-projected games that actually ran below average
const BIG_FAVORITE = 7;         // Spread at which to add the game-flow note

const ROOF_LABELS = {
  dome: 'Dome',
  outdoors: 'Outdoors',
  closed: 'Retractable roof (closed)',
  open: 'Retractable roof (open)',
};

// League rankings columns. bestHigh = true means a higher number is better.
const RANKING_COLUMNS = [
  { key: 'off', label: 'Offense', bestHigh: true },
  { key: 'def', label: 'Defense (allowed)', bestHigh: false },
  { key: 'net', label: 'Net', bestHigh: true },
  { key: 'sos', label: 'Schedule', short: 'SOS', bestHigh: true, needsSchedule: true },
];
// Estimated spread: home margin (points) = SPREAD_HOME_POINTS + slope x composite difference.
// Slopes were fitted on 2017-2025 games (current-season stats only, nfl_sos_backtest.py output).
// Early-season composites are noisy, so each EPA/play is worth fewer points until more weeks are played.
const SPREAD_HOME_POINTS = 1.8;
const SPREAD_SLOPES = [
  { lastWeek: 4, raw: 12.5, adj: 5.8 },
  { lastWeek: 8, raw: 43.0, adj: 34.1 },
  { lastWeek: Infinity, raw: 59.6, adj: 56.9 },
];

// Weekly overview columns. firstHigh = true means the first click lists the biggest values first.
const OVERVIEW_SORTS = {
  kickoff: { label: 'Kickoff', firstHigh: false },
  spread: { label: 'Spread', firstHigh: true },
  total: { label: 'Total', firstHigh: true },
  ml: { label: 'ML', firstHigh: true },
  raw: { label: 'Raw composite', firstHigh: true },
  adj: { label: 'Opponent-adjusted', firstHigh: true },
};

const SOS_MIN_WEEKS = 3;   // Matches SOS_MIN_WEEKS in nfl_team_stats.py
const SOS_NOTE_TIER = 6;   // Mention a unit's schedule in the context card if it's this close to either end
const INJURY_CARRIED = 'Out last game';   // Sat last game; team hasn't filed this week's report yet
const INJURY_OUT = ['IR', 'PUP', 'NFI', 'Out', 'Doubtful', INJURY_CARRIED];   // Statuses treated as "not playing"
const RESERVE_LONG = { IR: 'injured reserve', PUP: 'the PUP list', NFI: 'the non-football injury list' };

const state = {
  index: null,
  snapshot: null,
  view: 'matchup',
  mode: 'game',
  gameId: null,
  stats: 'raw',
  sort: { key: 'off', bestFirst: true },
  overviewSort: { key: 'kickoff', reversed: false },
};

const $ = (id) => document.getElementById(id);

// ----------------------------------------------------------------------
// Small formatting helpers
// ----------------------------------------------------------------------

/**
 * Escape text so it can be safely placed inside HTML.
 * @param {*} value - Any value; it is converted to a string.
 * @returns {string} HTML-safe text.
 */
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/**
 * Format a number with a leading + when positive (and no "-0.000").
 * @param {number} value - The number to format.
 * @param {number} digits - Decimal places.
 * @returns {string} e.g. "+0.123" or "-0.045".
 */
function signed(value, digits) {
  const text = value.toFixed(digits);
  if (Number(text) === 0) return (0).toFixed(digits);
  return value > 0 ? `+${text}` : text;
}

/**
 * Format a stat value for display based on its type.
 * @param {number|null} value - The raw stat value.
 * @param {string} fmt - One of "epa", "pct", "ypp", "cpoe", "num1".
 * @returns {string} Display text, or an em dash when missing.
 */
function fmtStat(value, fmt) {
  if (value == null) return '—';
  switch (fmt) {
    case 'epa': return signed(value, 3);
    case 'pct': return `${(value * 100).toFixed(1)}%`;
    case 'ypp': return value.toFixed(2);
    case 'cpoe': return signed(value, 1);
    default: return value.toFixed(1);
  }
}

/**
 * Turn a number into an ordinal, e.g. 1 -> "1st", 22 -> "22nd".
 * @param {number} n - A positive whole number.
 * @returns {string} The ordinal text.
 */
function ordinal(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
}

/**
 * Build the small colored rank label shown under a stat value.
 * @param {number|null} rank - Rank 1-32 (1 = best), or null.
 * @returns {string} HTML for the rank label.
 */
function rankHtml(rank) {
  if (rank == null) return '<span class="rank">—</span>';
  const cls = rank <= TOP_TIER ? 'top' : rank >= BOTTOM_TIER ? 'bottom' : '';
  return `<span class="rank ${cls}">${ordinal(rank)}</span>`;
}

/**
 * Describe a strength-of-schedule rank in plain words.
 * @param {number|null} rank - Rank 1-32 (1 = toughest schedule), or null.
 * @param {boolean} hyphen - True for "3rd-toughest" (before a noun), false for "3rd toughest".
 * @returns {string} e.g. "3rd toughest", "toughest", or "5th easiest"; an em dash when missing.
 */
function scheduleText(rank, hyphen = false) {
  if (rank == null) return '—';
  const total = Object.keys(state.snapshot.teams).length;
  const toughest = rank <= total / 2;
  const n = toughest ? rank : total + 1 - rank;
  const word = toughest ? 'toughest' : 'easiest';
  if (n === 1) return word;
  return `${ordinal(n)}${hyphen ? '-' : ' '}${word}`;
}

/**
 * Format a percentage stored as a 0-1 fraction.
 * @param {number|null} value - Fraction between 0 and 1.
 * @param {number} digits - Decimal places.
 * @returns {string} e.g. "62.5%".
 */
function pct(value, digits = 1) {
  return value == null ? '—' : `${(value * 100).toFixed(digits)}%`;
}

/**
 * Format an American moneyline, e.g. 140 -> "+140".
 * @param {number|null} ml - Moneyline.
 * @returns {string} Display text.
 */
function fmtMoneyline(ml) {
  if (ml == null) return '—';
  return ml > 0 ? `+${ml}` : String(ml);
}

/**
 * Convert an American moneyline to the win chance it implies (vig included).
 * @param {number|null} ml - Moneyline.
 * @returns {number|null} Probability between 0 and 1.
 */
function impliedProb(ml) {
  if (ml == null) return null;
  return ml < 0 ? -ml / (-ml + 100) : 100 / (ml + 100);
}

/**
 * Market win chance for the home team, with the sportsbook's margin removed.
 * @param {object} line - Object with away_moneyline and home_moneyline.
 * @returns {number|null} Home win probability between 0 and 1.
 */
function homeWinChance(line) {
  const home = impliedProb(line.home_moneyline);
  const away = impliedProb(line.away_moneyline);
  return home == null || away == null ? null : home / (home + away);
}

/**
 * Describe a spread from the favorite's point of view.
 * In nflverse, a positive spread_line means the HOME team is favored.
 * @param {number|null} spread - nflverse spread_line.
 * @param {string} away - Away team abbreviation.
 * @param {string} home - Home team abbreviation.
 * @returns {string} e.g. "KC -3.5" or "Pick'em".
 */
function spreadText(spread, away, home) {
  if (spread == null) return '—';
  if (spread === 0) return "Pick'em";
  return spread > 0 ? `${home} -${spread}` : `${away} -${-spread}`;
}

/**
 * Format kickoff date and time, e.g. "Sun 10/11 · 1:00 PM ET".
 * @param {object} game - Game with gameday ("YYYY-MM-DD") and gametime ("HH:MM", Eastern).
 * @returns {string} Display text.
 */
function kickoffText(game) {
  const day = new Date(`${game.gameday}T12:00:00`)
    .toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
  if (!game.gametime) return `${day} · TBD`;
  const [h, m] = game.gametime.split(':').map(Number);
  const hour12 = ((h + 11) % 12) + 1;
  return `${day} · ${hour12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'} ET`;
}

/**
 * Format an ISO timestamp from the data files, e.g. "Oct 5, 1:01 PM".
 * @param {string} iso - ISO 8601 timestamp.
 * @returns {string} Display text.
 */
function timeText(iso) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

// ----------------------------------------------------------------------
// Data lookups
// ----------------------------------------------------------------------

/**
 * Fetch and parse a JSON file, always asking for the latest copy.
 * @param {string} url - Relative path to the JSON file.
 * @returns {Promise<object>} Parsed data.
 */
async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Could not load ${url} (HTTP ${response.status}).`);
  return response.json();
}

/**
 * Get a team's display info from the current snapshot.
 * @param {string} abbr - Team abbreviation.
 * @returns {{name: string, nick: string, color: string}} Team info.
 */
function team(abbr) {
  return state.snapshot.teams[abbr] || { name: abbr, nick: abbr, color: '#64748b' };
}

/**
 * Build a team label with a small color swatch.
 * @param {string} abbr - Team abbreviation.
 * @param {boolean} [full=true] - Full name if true, nickname if false.
 * @returns {string} HTML for the badge.
 */
function teamBadge(abbr, full = true) {
  const info = team(abbr);
  return `<span class="team-badge"><span class="team-swatch" style="background:${esc(info.color)}"></span>${esc(full ? info.name : info.nick)}</span>`;
}

/**
 * Whether a game has a final score.
 * @param {object} game - Game object from the snapshot.
 * @returns {boolean} True when the game has been played.
 */
function isFinal(game) {
  return game.home_score != null && game.away_score != null;
}

/**
 * The most recent recorded betting lines for a game.
 * @param {object} game - Game object from the snapshot.
 * @returns {object} Object with spread_line, total_line, and moneylines.
 */
function latestLine(game) {
  const history = game.line_history || [];
  return history.length ? history[history.length - 1] : game;
}

/**
 * Work out the current away/home teams and scheduled game (if any).
 * @returns {{away: string, home: string, game: object|null}} The selection.
 */
function currentSelection() {
  if (state.mode === 'game') {
    const game = state.snapshot.games.find((g) => g.game_id === state.gameId);
    return { away: game.away_team, home: game.home_team, game };
  }
  const away = $('away-select').value;
  const home = $('home-select').value;
  const game = state.snapshot.games.find((g) => g.away_team === away && g.home_team === home) || null;
  return { away, home, game };
}

// ----------------------------------------------------------------------
// Pickers
// ----------------------------------------------------------------------

/**
 * Fill the week dropdown from weeks.json and select the current week.
 * @returns {number} The week number selected by default.
 */
function fillWeekSelect() {
  const { weeks, current_week: currentWeek } = state.index;
  $('week-select').innerHTML = weeks.slice().reverse().map((w) => {
    let status = 'upcoming';
    if (w.games_final === w.games) status = 'final';
    else if (w.games_final > 0) status = `in progress, ${w.games_final}/${w.games} final`;
    return `<option value="${w.week}">Week ${w.week} (${status})</option>`;
  }).join('');
  const defaultWeek = weeks.some((w) => w.week === currentWeek) ? currentWeek : weeks[weeks.length - 1].week;
  $('week-select').value = defaultWeek;
  return defaultWeek;
}

/**
 * Fill the game dropdown and the two team dropdowns for the loaded week.
 * @returns {void}
 */
function fillGameAndTeamSelects() {
  const { games, teams } = state.snapshot;
  $('game-select').innerHTML = games.map((g) => {
    const line = latestLine(g);
    const extra = isFinal(g)
      ? `Final ${g.away_score}-${g.home_score}`
      : spreadText(line.spread_line, g.away_team, g.home_team);
    return `<option value="${esc(g.game_id)}">${esc(kickoffText(g))} · ${esc(g.away_team)} @ ${esc(g.home_team)} (${esc(extra)})</option>`;
  }).join('');

  if (!games.some((g) => g.game_id === state.gameId)) {
    const next = games.find((g) => !isFinal(g)) || games[0];
    state.gameId = next ? next.game_id : null;
  }
  $('game-select').value = state.gameId;

  const keepAway = $('away-select').value;
  const keepHome = $('home-select').value;
  const options = Object.keys(teams)
    .sort((a, b) => teams[a].name.localeCompare(teams[b].name))
    .map((abbr) => `<option value="${esc(abbr)}">${esc(teams[abbr].name)}</option>`)
    .join('');
  $('away-select').innerHTML = options;
  $('home-select').innerHTML = options;
  const fallback = games.find((g) => g.game_id === state.gameId);
  $('away-select').value = keepAway || (fallback && fallback.away_team);
  $('home-select').value = keepHome || (fallback && fallback.home_team);
}

/**
 * Load one week's snapshot, refresh the pickers, and redraw the page.
 * @param {number} week - Week number to load.
 * @returns {Promise<void>}
 */
async function loadWeek(week) {
  const entry = state.index.weeks.find((w) => w.week === Number(week));
  state.snapshot = await fetchJson(`data/${entry.file}`);
  fillGameAndTeamSelects();
  renderHeader();
  updateStatsToggle();
  render();
}

/**
 * Whether this week's snapshot has opponent-adjusted stats (they start after SOS_MIN_WEEKS weeks).
 * @returns {boolean}
 */
function hasAdjusted() {
  return Object.keys(state.snapshot.offense_adj || {}).length > 0;
}

/**
 * The offense and defense tables the stat tables and rankings should use,
 * based on the Raw / Opponent-adjusted toggle.
 * @returns {{offense: object, defense: object, adjusted: boolean}}
 */
function statTables() {
  const snap = state.snapshot;
  return state.stats === 'adj' && hasAdjusted()
    ? { offense: snap.offense_adj, defense: snap.defense_adj, adjusted: true }
    : { offense: snap.offense, defense: snap.defense, adjusted: false };
}

/**
 * Sync the Raw / Opponent-adjusted buttons and hint with the current week.
 * The adjusted button is disabled for weeks that don't have adjusted stats yet;
 * the user's choice is kept so it comes back on later weeks.
 * @returns {void}
 */
function updateStatsToggle() {
  const available = hasAdjusted();
  const shown = available ? state.stats : 'raw';
  document.querySelectorAll('#stats-toggle button').forEach((b) => {
    b.classList.toggle('active', b.dataset.stats === shown);
    if (b.dataset.stats === 'adj') b.disabled = !available;
  });
  let hint = '';
  if (!available) hint = `Opponent-adjusted stats appear once teams have ${SOS_MIN_WEEKS} weeks of games.`;
  else if (shown === 'adj') hint = 'Each stat is adjusted for the opponents faced. Shown for context: in testing, adjusted numbers predicted games slightly worse than raw. The game script and pace stay raw.';
  $('stats-hint').textContent = hint;
  $('stats-hint').classList.toggle('hidden', !hint);
}

/**
 * Switch the stat tables and rankings between raw and opponent-adjusted stats.
 * @param {string} stats - "raw" or "adj".
 * @returns {void}
 */
function setStats(stats) {
  state.stats = stats;
  updateStatsToggle();
  render();
}

// ----------------------------------------------------------------------
// Page sections
// ----------------------------------------------------------------------

/**
 * Show the "updated through week N" label and the small-sample warning.
 * @returns {void}
 */
function renderHeader() {
  const snap = state.snapshot;
  const through = snap.stats_through_week;
  $('updated-label').textContent =
    `${snap.season} season · Week ${snap.week} games · Stats updated through week ${through} · ` +
    `Refreshed ${timeText(state.index.updated_at)}`;

  const weeksWord = through === 1 ? 'week' : 'weeks';
  $('sample-warning').innerHTML = through < SMALL_SAMPLE_WEEKS
    ? `<strong>Very small sample:</strong> these stats cover only ${through} ${weeksWord} of games, so ranks can swing a lot from week to week. Treat early-season edges with caution.`
    : `<strong>Small-sample reminder:</strong> stats cover ${through} ${weeksWord}. A single game still moves ranks, especially red zone, turnover, and rushing stats.`;
}

/**
 * Draw every section for the current selection.
 * @returns {void}
 */
function render() {
  const errorBox = $('error-box');
  if (state.view === 'rankings') {
    errorBox.classList.add('hidden');
    renderRankings();
    return;
  }
  if (state.view === 'overview') {
    errorBox.classList.add('hidden');
    renderOverview();
    return;
  }
  const { away, home, game } = currentSelection();
  if (away === home) {
    errorBox.textContent = 'Pick two different teams.';
    errorBox.classList.remove('hidden');
    $('matchup').classList.add('hidden');
    return;
  }
  errorBox.classList.add('hidden');
  $('matchup').classList.remove('hidden');

  renderGameCard(away, home, game);
  renderGameScript(away, home, game);
  renderInjuries(away, home);
  renderLinesCard(away, home, game);
  renderComposite(away, home, game);
  renderContext(away, home, game);
  $('away-matchup').innerHTML = matchupTableHtml(away, home);
  $('home-matchup').innerHTML = matchupTableHtml(home, away);
  renderGlossary();
}

/**
 * Game header: teams, kickoff, and the final result once played.
 * @param {string} away - Away team abbreviation.
 * @param {string} home - Home team abbreviation.
 * @param {object|null} game - Scheduled game, or null for a custom matchup.
 * @returns {void}
 */
function renderGameCard(away, home, game) {
  let meta = 'Custom matchup: these teams are not scheduled to play each other this week.';
  let final = '';
  if (game) {
    meta = `Week ${game.week} · ${kickoffText(game)}`;
    if (isFinal(game)) final = `<div class="final-line">${resultHtml(game)}</div>`;
  }
  if (state.snapshot.backfilled) {
    meta += ' · This week was rebuilt after it was played, using stats from before the games.';
  }
  $('game-card').innerHTML = `
    <div class="game-title">${teamBadge(away)} <span class="at">@</span> ${teamBadge(home)}</div>
    <div class="meta">${esc(meta)}</div>${final}`;
}

/**
 * League mean and standard deviation of one stat column in the current snapshot.
 * @param {string} side - "offense" or "defense".
 * @param {string} stat - Stat key, e.g. "pass_epa".
 * @returns {{mean: number, sd: number}} Spread of the stat across teams (sample SD).
 */
function statSpread(side, stat) {
  const snap = state.snapshot;
  snap.spreadCache = snap.spreadCache || {};
  const key = `${side}.${stat}`;
  if (!snap.spreadCache[key]) {
    const values = Object.values(snap[side]).map((t) => t[stat]).filter((v) => v != null);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
    snap.spreadCache[key] = { mean, sd: Math.sqrt(variance) };
  }
  return snap.spreadCache[key];
}

/**
 * Matchup score for one game script area (positive = the offense should excel).
 * @param {object} area - Entry from SCRIPT_AREAS.
 * @param {string} off - Offense team abbreviation.
 * @param {string} def - Defense team abbreviation.
 * @returns {number|null} Average of the offense and defense z-scores, or null if data is missing.
 */
function areaScore(area, off, def) {
  const scores = area.stats.map((stat) => {
    const o = state.snapshot.offense[off]?.[stat];
    const d = state.snapshot.defense[def]?.[stat];
    if (o == null || d == null) return null;
    const os = statSpread('offense', stat);
    const ds = statSpread('defense', stat);
    return area.sign * ((o - os.mean) / os.sd + (d - ds.mean) / ds.sd) / 2;
  }).filter((s) => s != null);
  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
}

/**
 * Projected total plays in a game: each offense's plays per game averaged with
 * the plays per game the opposing defense faces (offense pace only if missing).
 * @param {string} away - Away team abbreviation.
 * @param {string} home - Home team abbreviation.
 * @returns {number|null} Projected plays for both teams combined.
 */
function gamePace(away, home) {
  const { offense, defense } = state.snapshot;
  const side = (off, def) => {
    const o = offense[off]?.plays_per_game;
    const d = defense[def]?.plays_per_game ?? o;
    return o == null ? null : (o + d) / 2;
  };
  const a = side(away, home);
  const h = side(home, away);
  return a == null || h == null ? null : a + h;
}

/**
 * Projected pace for every possible pairing of teams in the current snapshot,
 * used to judge whether a matchup is unusually fast or slow.
 * @returns {number[]} One projected play total per pairing.
 */
function allPairingPaces() {
  const snap = state.snapshot;
  if (!snap.paceCache) {
    const abbrs = Object.keys(snap.teams);
    snap.paceCache = abbrs.flatMap((a) => abbrs.filter((h) => h !== a).map((h) => gamePace(a, h)))
      .filter((p) => p != null);
  }
  return snap.paceCache;
}

/**
 * Game script calls (excel/struggle with confidence) and fantasy angles for one offense.
 * @param {string} off - Offense team abbreviation.
 * @param {string} def - Defense team abbreviation.
 * @returns {{excel: string[], struggle: string[], fantasy: string[]}} HTML list items.
 */
function scriptCalls(off, def) {
  const result = { excel: [], struggle: [], fantasy: [] };
  SCRIPT_AREAS.forEach((area) => {
    const score = areaScore(area, off, def);
    if (score == null) return;
    const size = Math.abs(score);
    let level = null;
    if (size >= area.strong) level = { name: 'Strong', cls: 'strong', hit: area.strongHit };
    else if (area.lean != null && size >= area.lean) level = { name: 'Lean', cls: 'lean', hit: area.leanHit };
    if (!level) return;

    const excels = score > 0;
    const primary = STATS.find((s) => s.key === area.stats[0]);
    const offRank = state.snapshot.offense[off]?.[`${primary.key}_rank`];
    const defRank = state.snapshot.defense[def]?.[`${primary.key}_rank`];
    const ranks = offRank && defRank
      ? ` <span class="meta">(${esc(primary.label)}: offense ${ordinal(offRank)}, ${esc(def)} defense ${ordinal(defRank)})</span>`
      : '';
    const item = `<span class="chip ${level.cls}">${level.name}</span> <strong>${esc(area.label)}:</strong> ` +
      `${esc(excels ? area.excel : area.struggle)}.${ranks} ` +
      `<span class="meta">Right in ${level.hit}% of similar past matchups.</span>`;
    (excels ? result.excel : result.struggle).push(item);
    const angle = (excels ? area.fantasyExcel : area.fantasyStruggle).replace('{def}', def);
    result.fantasy.push(`${esc(angle)} <span class="meta">(${level.name.toLowerCase()})</span>`);
  });
  return result;
}

/**
 * Game script card: where each offense should excel or struggle, fantasy angles,
 * and pace / game-flow notes.
 * @param {string} away - Away team abbreviation.
 * @param {string} home - Home team abbreviation.
 * @param {object|null} game - Scheduled game (for the spread), or null for a custom matchup.
 * @returns {void}
 */
function renderGameScript(away, home, game) {
  const { offense, defense } = state.snapshot;
  const notes = [];
  const sideHtml = (off, def) => {
    const calls = scriptCalls(off, def);
    const list = (items, empty) => (items.length ? `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>` : `<p class="none">${empty}</p>`);
    return `<div class="script-side">
      <h3>${teamBadge(off, false)} offense vs ${esc(team(def).nick)} defense</h3>
      <h4>Should excel</h4>${list(calls.excel, 'No clear strengths in this matchup.')}
      <h4>Should struggle</h4>${list(calls.struggle, 'No clear weaknesses in this matchup.')}
      <h4>Fantasy angle</h4>${list(calls.fantasy, 'No strong angle from these stats.')}
    </div>`;
  };

  const projected = gamePace(away, home);
  if (projected != null) {
    const all = allPairingPaces();
    const share = all.filter((p) => p < projected).length / all.length;
    const diff = projected - all.reduce((a, b) => a + b, 0) / all.length;
    if (share >= 1 - PACE_TAIL) {
      notes.push(`<strong>Pace:</strong> one of the fastest projected matchups (about ${diff.toFixed(1)} more plays than average). ` +
        `${PACE_FAST_HIT}% of games projected this fast ran above average. Fantasy: extra volume for both teams.`);
    } else if (share <= PACE_TAIL) {
      notes.push(`<strong>Pace:</strong> one of the slowest projected matchups (about ${(-diff).toFixed(1)} fewer plays than average). ` +
        `${PACE_SLOW_HIT}% of games projected this slow ran below average. Fantasy: less volume for both teams.`);
    } else {
      notes.push('<strong>Pace:</strong> projects close to an average number of plays, so no volume angle.');
    }
  }

  const spread = game ? latestLine(game).spread_line : null;
  if (spread != null && Math.abs(spread) >= BIG_FAVORITE) {
    const fav = spread > 0 ? home : away;
    notes.push(`<strong>Game flow:</strong> the ${esc(team(fav).nick)} are big favorites (${esc(spreadText(spread, away, home))}). ` +
      'Historically, teams favored by 7+ throw only about 1 percentage point less than usual, and underdogs barely change, ' +
      `so expect only a slight lean toward the run. Fantasy: small volume bump for ${esc(fav)} RBs.`);
  }

  $('script-card').innerHTML = `
    <h2>Game script</h2>
    <div class="script-grid">${sideHtml(away, home)}${sideHtml(home, away)}</div>
    ${notes.length ? `<ul class="script-notes">${notes.map((n) => `<li>${n}</li>`).join('')}</ul>` : ''}
    <p class="explain">Calls compare each offense with the opposing defense against league average. Labels and
      percentages come from testing the same method on every game from 2015 to 2025, using only stats from before
      each game. <span class="chip lean">Lean</span> calls were right about 6 times in 10 and
      <span class="chip strong">Strong</span> calls about 7 in 10. Third downs, red zone, and turnovers are left out
      because they're mostly luck from game to game. The test blended in last season's stats during the first six
      weeks; this page uses this season only, so treat early-season calls as less certain than these percentages.</p>
    ${statTables().adjusted ? '<p class="explain">The game script always uses raw stats, because its percentages were tested on them.</p>' : ''}`;
}

/**
 * A team's key injured players from the current snapshot.
 * @param {string} abbr - Team abbreviation.
 * @returns {object[]|null} Player entries (see nfl_injuries.py), or null if the team has no injury data this week.
 */
function teamInjuries(abbr) {
  const teams = state.snapshot.injuries?.teams;
  return teams && teams[abbr] ? teams[abbr] : null;
}

/**
 * Colored chip for an injury status (red = not playing, amber = questionable).
 * @param {string} status - e.g. "Out", "IR", "Questionable".
 * @returns {string} HTML chip.
 */
function injuryChip(status) {
  return `<span class="chip ${INJURY_OUT.includes(status) ? 'def' : 'lean'}">${esc(status)}</span>`;
}

/**
 * One injured player's line in the Key injuries card.
 * @param {object} p - Player entry from the snapshot.
 * @returns {string} HTML list item.
 */
function injuryItemHtml(p) {
  const about = [esc(p.position || p.group)];
  if (p.string) about.push(`usually ${ordinal(p.string)} string`);
  if (p.snap_pct) about.push(`${Math.round(p.snap_pct * 100)}% of snaps`);

  const details = [];
  if (p.injury) details.push(esc(p.injury));
  if (p.practice) details.push(esc(p.practice));
  if (RESERVE_LONG[p.status] && p.reserve_since) {
    let text = `On ${RESERVE_LONG[p.status]} since week ${p.reserve_since}`;
    if (p.return_week) text += `, earliest return week ${p.return_week}`;
    details.push(text);
  }
  if (p.status === INJURY_CARRIED && p.report_week) details.push(`Out in week ${p.report_week}; this week's report isn't filed yet`);
  if (p.games_missed) details.push(`missed the last ${p.games_missed} game${p.games_missed === 1 ? '' : 's'}`);

  const next = p.next_up ? `Next up: ${esc(p.next_up.name)} (${ordinal(p.next_up.string)} string)` : 'Next up: not listed';
  return `<li>${injuryChip(p.status)} <strong>${esc(p.name)}</strong> <span class="inj-about">${about.join(' · ')}</span>
    ${details.length ? `<span class="inj-detail">${details.join(' · ')}</span>` : ''}
    <span class="inj-detail">${next}</span></li>`;
}

/**
 * Fantasy notes from one team's key players who are not expected to play.
 * @param {string} abbr - The injured team.
 * @param {string} opp - Its opponent.
 * @param {object[]} players - The team's injury entries.
 * @returns {string[]} HTML notes.
 */
function injuryFantasyNotes(abbr, opp, players) {
  const out = players.filter((p) => INJURY_OUT.includes(p.status));
  const nick = esc(team(abbr).nick);
  const oppNick = esc(team(opp).nick);
  const nextName = (p) => (p.next_up ? esc(p.next_up.name) : 'the backup');
  const names = (list) => list.map((p) => esc(p.name)).join(', ');
  const endSentence = (text) => (text.endsWith('.') ? text : `${text}.`);
  const group = (g) => out.filter((p) => p.group === g);
  const isOut = (p) => (p.status === INJURY_CARRIED ? `sat last game and may miss this one` : 'is out');
  const notes = [];

  group('QB').forEach((p) => notes.push(`<strong>${nick} QB:</strong> ${esc(p.name)} ${isOut(p)}, so ${nextName(p)} would start. ` +
    `Downgrade ${esc(abbr)} pass catchers and upgrade the ${oppNick} defense (DST).`));
  group('RB').forEach((p) => notes.push(`<strong>${nick} RB:</strong> ${esc(p.name)} ${isOut(p)}. Upgrade ${nextName(p)}, who should get more carries.`));
  const wrs = group('WR');
  if (wrs.length) {
    notes.push(`<strong>${nick} WR:</strong> ${names(wrs)} ${wrs.length === 1 ? 'is' : 'are'} out. ` +
      `More targets for the other ${esc(abbr)} receivers and TE${wrs.length === 1 ? `; ${nextName(wrs[0])} moves into the lineup` : ''}.`);
  }
  group('TE').forEach((p) => notes.push(`<strong>${nick} TE:</strong> ${esc(p.name)} ${isOut(p)}. ${nextName(p)} steps in; small target bump for the ${esc(abbr)} WRs.`));
  const line = group('OL');
  if (line.length >= 2) {
    notes.push(`<strong>${nick} O-line:</strong> ${line.length} starters out (${names(line)}). Expect more pressure on the QB ` +
      `and a weaker run game; small upgrade for the ${oppNick} DST.`);
  } else if (line.length === 1) {
    notes.push(`<strong>${nick} O-line:</strong> ${names(line)} ${isOut(line[0])}. Small downgrade for the ${esc(abbr)} offense.`);
  }
  const rush = [...group('DL'), ...group('LB')];
  if (rush.length) {
    notes.push(`<strong>${nick} front seven:</strong> without ${endSentence(names(rush))} The ${oppNick} QB may get more time and ` +
      `the run game more room; small upgrade for ${esc(opp)} skill players.`);
  }
  const dbs = group('DB');
  if (dbs.length) {
    notes.push(`<strong>${nick} secondary:</strong> without ${endSentence(names(dbs))} Upgrade the ${oppNick} passing game, especially ` +
      `${dbs.length >= 2 ? 'with several starters missing' : 'the receiver facing that spot'}.`);
  }
  return notes;
}

/**
 * Key injuries card: each team's injured starters, who replaces them, and fantasy notes.
 * @param {string} away - Away team abbreviation.
 * @param {string} home - Home team abbreviation.
 * @returns {void}
 */
function renderInjuries(away, home) {
  const card = $('injury-card');
  const inj = state.snapshot.injuries;
  if (!inj || !inj.teams) {
    card.innerHTML = '<h2>Key injuries</h2><p class="meta">No injury data in this week\'s snapshot.</p>';
    return;
  }

  const sideHtml = (abbr) => {
    const players = teamInjuries(abbr);
    let body;
    if (!players) {
      body = '<p class="none">Not playing this week, so no injury report.</p>';
    } else if (!players.length) {
      body = '<p class="none">No key players listed.</p>';
    } else {
      body = ['offense', 'defense'].map((side) => {
        const list = players.filter((p) => p.side === side);
        return list.length ? `<h4>${side === 'offense' ? 'Offense' : 'Defense'}</h4><ul class="inj-list">${list.map(injuryItemHtml).join('')}</ul>` : '';
      }).join('');
    }
    return `<div class="script-side"><h3>${teamBadge(abbr, false)}</h3>${body}</div>`;
  };

  const notes = [
    ...injuryFantasyNotes(away, home, teamInjuries(away) || []),
    ...injuryFantasyNotes(home, away, teamInjuries(home) || []),
  ];
  const status = inj.report_available
    ? 'From the official injury report (teams file Wednesday to Friday; final game statuses come out Friday).'
    : 'This week\'s injury report isn\'t out yet (teams file Wednesday to Friday), so this shows players on IR or PUP ' +
      'and starters who sat last game ("Out last game"). Some of them may return this week.';
  const depth = inj.depth_chart_date ? ` Depth chart as of ${esc(timeText(inj.depth_chart_date))}.` : '';

  card.innerHTML = `
    <h2>Key injuries</h2>
    <div class="script-grid">${sideHtml(away)}${sideHtml(home)}</div>
    ${notes.length ? `<h4 class="inj-notes-title">Fantasy notes</h4><ul class="script-notes">${notes.map((n) => `<li>${n}</li>`).join('')}</ul>` : ''}
    <p class="explain">${status}${depth} Key players are depth chart starters or anyone who has played at least half
      of his side's snaps. "Usually 1st string" is his best spot over the last 3 weeks, since teams often move an
      injured starter down. Free data has no return dates, so the page shows games missed and, for IR or PUP, the
      earliest week he's allowed back (4 games later). Most Questionable players end up playing.</p>`;
}

/**
 * Small injury tags for one team in the weekly overview, e.g. "BAL 2 out".
 * @param {string} abbr - Team abbreviation.
 * @returns {string} HTML chips (empty if nothing to flag).
 */
function injuryTags(abbr) {
  const players = teamInjuries(abbr);
  if (!players) return '';
  const out = players.filter((p) => INJURY_OUT.includes(p.status));
  const questionable = players.length - out.length;
  const chips = [];
  if (out.some((p) => p.group === 'QB')) chips.push(`<span class="chip def big">${esc(abbr)} QB out</span>`);
  if (out.length) chips.push(`<span class="chip def">${esc(abbr)} ${out.length} out</span>`);
  if (questionable) chips.push(`<span class="chip lean">${esc(abbr)} ${questionable} Q</span>`);
  return chips.join(' ');
}

/**
 * Describe a final score against the last recorded spread and total.
 * @param {object} game - A game with final scores.
 * @returns {string} HTML sentence(s) about the result.
 */
function resultHtml(game) {
  const { away_team: away, home_team: home, away_score: awayPts, home_score: homePts } = game;
  const margin = homePts - awayPts;
  const winner = margin > 0 ? home : away;
  const parts = [`<strong>Final: ${esc(away)} ${awayPts}, ${esc(home)} ${homePts}</strong>` +
    (margin === 0 ? ' (tie).' : ` (${esc(winner)} won by ${Math.abs(margin)}).`)];

  const line = latestLine(game);
  if (line.spread_line != null) {
    const ats = margin - line.spread_line;
    const covered = ats > 0 ? `${home} covered` : ats < 0 ? `${away} covered` : 'Push';
    parts.push(`Spread ${esc(spreadText(line.spread_line, away, home))}: ${esc(covered)}.`);
  }
  if (line.total_line != null) {
    const total = homePts + awayPts;
    const ou = total > line.total_line ? 'Over' : total < line.total_line ? 'Under' : 'Push';
    parts.push(`Total ${total} vs ${line.total_line}: ${ou}.`);
  }
  return parts.join(' ');
}

/**
 * Betting lines (spread, total, moneylines) and how they moved this week.
 * @param {string} away - Away team abbreviation.
 * @param {string} home - Home team abbreviation.
 * @param {object|null} game - Scheduled game, or null for a custom matchup.
 * @returns {void}
 */
function renderLinesCard(away, home, game) {
  const card = $('lines-card');
  if (!game) {
    card.innerHTML = '<h2>Betting lines</h2><p class="meta">No lines: this matchup is not on the schedule this week.</p>';
    return;
  }
  const line = latestLine(game);
  const homeChance = homeWinChance(line);
  const chanceText = homeChance == null ? '—'
    : `${esc(away)} ${pct(1 - homeChance, 0)} · ${esc(home)} ${pct(homeChance, 0)}`;

  card.innerHTML = `
    <h2>Betting lines</h2>
    <div class="tiles">
      <div class="tile"><div class="label">Spread</div><div class="value">${esc(spreadText(line.spread_line, away, home))}</div></div>
      <div class="tile"><div class="label">Total (over/under)</div><div class="value">${line.total_line ?? '—'}</div></div>
      <div class="tile"><div class="label">Moneylines</div>
        <div class="value">${esc(away)} ${fmtMoneyline(line.away_moneyline)} · ${esc(home)} ${fmtMoneyline(line.home_moneyline)}</div></div>
      <div class="tile"><div class="label">Market win chance</div><div class="value">${chanceText}</div>
        <div class="detail">From the moneylines, with the sportsbook's cut removed</div></div>
    </div>
    <h2 style="margin-top:16px">Line movement</h2>
    ${lineMovementHtml(game)}`;
}

/**
 * Plain-English notes on how a game's lines moved since first recorded.
 * @param {object} game - Scheduled game with a line_history list.
 * @returns {string} HTML list of movement notes plus a history table.
 */
function lineMovementHtml(game) {
  const history = game.line_history || [];
  if (!history.length) return '<p class="meta">No lines recorded.</p>';
  const first = history[0];
  const last = history[history.length - 1];
  const { away_team: away, home_team: home } = game;

  if (history.length === 1) {
    const note = first.note
      ? `${first.note}, so there's no movement to show.`
      : `First recorded ${timeText(first.time)}. Run the script again later in the week to track changes.`;
    return `<p class="meta">${esc(note)}</p>`;
  }

  const notes = [];
  if (first.spread_line != null && last.spread_line != null && first.spread_line !== last.spread_line) {
    const delta = last.spread_line - first.spread_line;
    const toward = `the ${team(delta > 0 ? home : away).nick}`;
    let text = `Spread moved ${Math.abs(delta)} point${Math.abs(delta) === 1 ? '' : 's'} toward ${toward} ` +
      `(${spreadText(first.spread_line, away, home)} → ${spreadText(last.spread_line, away, home)}). ` +
      `The market now rates ${toward} stronger than it first did; common reasons are injury or lineup news, or heavy betting on ${toward}.`;
    const crossed = [3, 7].filter((k) => [k, -k].some((n) =>
      Math.min(first.spread_line, last.spread_line) < n && Math.max(first.spread_line, last.spread_line) > n));
    if (crossed.length) {
      text += ` It crossed ${crossed.join(' and ')}, ${crossed.length === 1 ? 'a key number' : 'both key numbers'}: ` +
        'many NFL games are decided by exactly 3 or 7 points, so moves through them matter more than other half-points.';
    }
    notes.push(text);
  }
  if (first.total_line != null && last.total_line != null && first.total_line !== last.total_line) {
    const delta = last.total_line - first.total_line;
    notes.push(delta > 0
      ? `Total rose ${delta} (${first.total_line} → ${last.total_line}). The market expects more scoring; common reasons are a better weather forecast, an offensive starter returning, or betting on the over.`
      : `Total fell ${-delta} (${first.total_line} → ${last.total_line}). The market expects less scoring; common reasons are wind or rain in the forecast, offensive injuries, or betting on the under.`);
  }
  const before = homeWinChance(first);
  const after = homeWinChance(last);
  if (before != null && after != null && Math.abs(after - before) >= 0.01) {
    notes.push(`The ${team(home).nick}' market win chance went from ${pct(before, 0)} to ${pct(after, 0)} ` +
      `(moneylines ${fmtMoneyline(first.home_moneyline)} → ${fmtMoneyline(last.home_moneyline)}).`);
  }
  if (!notes.length) notes.push('Lines changed only slightly (moneyline juice), with no meaningful movement.');

  const rows = history.map((h) => `<tr><td>${esc(timeText(h.time))}</td>
    <td>${esc(spreadText(h.spread_line, away, home))}</td><td class="num">${h.total_line ?? '—'}</td>
    <td class="num">${fmtMoneyline(h.away_moneyline)} / ${fmtMoneyline(h.home_moneyline)}</td></tr>`).join('');

  return `<ul class="moves">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
    <details style="margin-top:10px"><summary>Every recorded line (${history.length})</summary>
      <div class="table-scroll"><table>
        <thead><tr><th>Recorded</th><th>Spread</th><th class="num">Total</th><th class="num">ML (${esc(away)} / ${esc(home)})</th></tr></thead>
        <tbody>${rows}</tbody></table></div></details>`;
}

/**
 * Calculate both offenses' composites (average of offense EPA/play and
 * opposing defense EPA/play allowed) from one pair of offense/defense tables.
 * @param {string} away - Away team abbreviation.
 * @param {string} home - Home team abbreviation.
 * @param {object} offense - Offense table (raw or opponent-adjusted).
 * @param {object} defense - Defense table (raw or opponent-adjusted).
 * @returns {object} { sides: [away side, home side], better, diff } where each
 *   side has off, def, o, d, oRank, dRank, value; better is the side with the
 *   higher composite and diff is home minus away (null if data is missing).
 */
function compositeSides(away, home, offense, defense) {
  const sides = [[away, home], [home, away]].map(([off, def]) => {
    const o = offense[off]?.epa_per_play;
    const d = defense[def]?.epa_per_play;
    return {
      off, def, o, d,
      oRank: offense[off]?.epa_per_play_rank ?? null,
      dRank: defense[def]?.epa_per_play_rank ?? null,
      value: o == null || d == null ? null : (o + d) / 2,
    };
  });
  const [a, h] = sides;
  if (a.value == null || h.value == null) return { sides, better: null, diff: null };
  const diff = h.value - a.value;
  return { sides, better: diff > 0 ? h : a, diff };
}

/**
 * Composite projection, raw and opponent-adjusted side by side.
 * @param {string} away - Away team abbreviation.
 * @param {string} home - Home team abbreviation.
 * @param {object|null} game - Scheduled game (used to compare with a final score).
 * @returns {void}
 */
function renderComposite(away, home, game) {
  const snap = state.snapshot;
  const raw = compositeSides(away, home, snap.offense, snap.defense);
  const adj = hasAdjusted() ? compositeSides(away, home, snap.offense_adj, snap.defense_adj) : null;

  const valueHtml = (value) => `<span class="${value > 0 ? 'pos' : value < 0 ? 'neg' : ''}">${value == null ? '—' : signed(value, 3)}</span>`;
  const detailHtml = (s) => `${esc(s.off)} offense ${fmtStat(s.o, 'epa')} (${s.oRank == null ? '—' : ordinal(s.oRank)}) ·
    ${esc(s.def)} defense allows ${fmtStat(s.d, 'epa')} (${s.dRank == null ? '—' : ordinal(s.dRank)})`;

  const tiles = raw.sides.map((s, i) => {
    const a = adj?.sides[i];
    return `
    <div class="tile">
      <div class="label">${esc(team(s.off).nick)} offense vs ${esc(team(s.def).nick)} defense</div>
      <div class="value">${valueHtml(s.value)} <span class="unit">EPA/play</span></div>
      <div class="detail">Raw: ${detailHtml(s)}</div>
      ${a ? `<div class="adj-row"><span class="adj-label">Opponent-adjusted</span> <strong>${valueHtml(a.value)}</strong></div>
      <div class="detail">${detailHtml(a)}</div>` : ''}
    </div>`;
  }).join('');

  const winner = game && isFinal(game)
    ? (game.home_score > game.away_score ? home : game.home_score < game.away_score ? away : 'tie')
    : null;
  const matchText = (better) => {
    if (!winner) return '';
    if (winner === 'tie') return ' Result: tie.';
    return ` Result: the ${team(winner).nick} won${winner === better.off ? ', matching it' : ', against it'}.`;
  };

  let verdict = '';
  if (raw.better) {
    verdict = Math.abs(raw.diff) < 0.005
      ? 'The two offenses project about the same in this matchup.'
      : `The ${team(raw.better.off).nick}' offense has the stronger matchup by ${Math.abs(raw.diff).toFixed(3)} EPA per play.`;
    verdict += matchText(raw.better);
  }

  let adjVerdict = '';
  if (adj?.better && raw.better) {
    const nick = team(adj.better.off).nick;
    const size = Math.abs(adj.diff).toFixed(3);
    if (Math.abs(adj.diff) < 0.005) adjVerdict = 'Adjusted for opponents, the two offenses project about the same.';
    else if (adj.better.off === raw.better.off) adjVerdict = `Adjusted for opponents, the ${nick}' offense still has the edge, by ${size}.`;
    else adjVerdict = `Adjusted for opponents, the edge flips to the ${nick}' offense, by ${size}.`;
    if (Math.abs(adj.diff) >= 0.005 && adj.better.off !== raw.better.off) adjVerdict += matchText(adj.better);
  }

  const adjNote = adj
    ? 'The opponent-adjusted numbers give each team credit or blame for who it has played. They\'re shown for context: in a 2017–2025 test they picked winners slightly less often than the raw numbers.'
    : `Opponent-adjusted numbers appear once teams have ${SOS_MIN_WEEKS} weeks of games.`;

  $('composite-card').innerHTML = `
    <h2>Composite matchup</h2>
    <div class="tiles">${tiles}</div>
    <p class="explain"><strong>${esc(verdict)}</strong>${adjVerdict ? `<br>${esc(adjVerdict)}` : ''}</p>
    <p class="explain">Each number averages how well the offense has moved the ball (EPA per play) with how much the opposing defense usually gives up, so a higher number means that offense should have an easier time. ${esc(adjNote)}</p>`;
}

/**
 * Context: record vs Pythagorean expectation (luck gap), pace, rest, roof,
 * and strength of schedule.
 * @param {string} away - Away team abbreviation.
 * @param {string} home - Home team abbreviation.
 * @param {object|null} game - Scheduled game, or null for a custom matchup.
 * @returns {void}
 */
function renderContext(away, home, game) {
  const { pythagorean, offense } = state.snapshot;
  const p = (abbr) => pythagorean[abbr] || {};
  const record = (abbr) => {
    const r = p(abbr);
    if (r.games == null) return '—';
    return r.ties ? `${r.wins}-${r.losses}-${r.ties}` : `${r.wins}-${r.losses}`;
  };
  const perGame = (abbr, key) => (p(abbr).games ? (p(abbr)[key] / p(abbr).games).toFixed(1) : '—');
  const luck = (abbr) => (p(abbr).luck_gap == null ? '—' : `${signed(p(abbr).luck_gap * 100, 1)}%`);
  const pace = (abbr) => {
    const o = offense[abbr] || {};
    return o.plays_per_game == null ? '—' : `${o.plays_per_game.toFixed(1)} <span class="rank">${ordinal(o.plays_per_game_rank)} most</span>`;
  };

  const rows = [
    ['Record', record(away), record(home)],
    ['Points per game (scored / allowed)', `${perGame(away, 'pf')} / ${perGame(away, 'pa')}`, `${perGame(home, 'pf')} / ${perGame(home, 'pa')}`],
    ['Actual win %', pct(p(away).win_pct), pct(p(home).win_pct)],
    ['Pythagorean win %', pct(p(away).pythag_win_pct), pct(p(home).pythag_win_pct)],
    ['Luck gap (actual − Pythagorean)', luck(away), luck(home)],
    ['Plays per game (pace)', pace(away), pace(home)],
  ];
  if (game) rows.push(['Rest days', game.away_rest ?? '—', game.home_rest ?? '—']);

  const schedule = state.snapshot.schedule || {};
  const hasSchedule = Object.keys(schedule).length > 0;
  const s = (abbr) => schedule[abbr] || {};
  if (hasSchedule) {
    rows.push(
      ['Schedule faced (opponent strength)', scheduleText(s(away).sos_rank), scheduleText(s(home).sos_rank)],
      ['Defenses its offense has faced', scheduleText(s(away).off_sos_rank), scheduleText(s(home).off_sos_rank)],
      ['Offenses its defense has faced', scheduleText(s(away).def_sos_rank), scheduleText(s(home).def_sos_rank)],
    );
  }

  const roof = game ? (ROOF_LABELS[game.roof] || game.roof || 'Unknown') : null;
  let restNote = '';
  if (game && game.away_rest != null && game.home_rest != null && game.away_rest !== game.home_rest) {
    const days = Math.abs(game.away_rest - game.home_rest);
    const rested = team(game.away_rest > game.home_rest ? away : home).nick;
    restNote = ` The ${rested} have ${days} more day${days === 1 ? '' : 's'} of rest.`;
  }

  $('context-card').innerHTML = `
    <h2>Context</h2>
    <div class="table-scroll"><table>
      <thead><tr><th></th><th class="num">${teamBadge(away, false)}</th><th class="num">${teamBadge(home, false)}</th></tr></thead>
      <tbody>${rows.map(([label, a, h]) => `<tr><td>${esc(label)}</td><td class="num">${a}</td><td class="num">${h}</td></tr>`).join('')}</tbody>
    </table></div>
    ${roof ? `<p class="explain"><strong>Roof:</strong> ${esc(roof)}.${esc(restNote)}</p>` : ''}
    <p class="explain">Pythagorean win % is the record a team "should" have from its points scored and allowed. A big positive luck gap means it has won more than its scoring suggests (often close games) and may cool off; a big negative gap suggests it's better than its record.</p>
    ${scheduleNotesHtml(away, home, schedule)}`;
}

/**
 * Plain-English strength-of-schedule notes for the context card.
 * Only units whose schedule is near either end (SOS_NOTE_TIER) get a note.
 * @param {string} away - Away team abbreviation.
 * @param {string} home - Home team abbreviation.
 * @param {object} schedule - The snapshot's schedule table (may be empty).
 * @returns {string} HTML paragraphs.
 */
function scheduleNotesHtml(away, home, schedule) {
  if (!Object.keys(schedule).length) {
    return `<p class="explain">Strength of schedule appears once teams have ${SOS_MIN_WEEKS} weeks of games.</p>`;
  }
  const total = Object.keys(state.snapshot.teams).length;
  const notes = [];
  [away, home].forEach((abbr) => {
    const { nick } = team(abbr);
    const offRank = schedule[abbr]?.off_sos_rank;
    const defRank = schedule[abbr]?.def_sos_rank;
    if (offRank != null && offRank > total - SOS_NOTE_TIER) {
      notes.push(`The ${nick} offense has faced the ${scheduleText(offRank, true)} set of defenses, so its numbers may be inflated.`);
    } else if (offRank != null && offRank <= SOS_NOTE_TIER) {
      notes.push(`The ${nick} offense has faced the ${scheduleText(offRank, true)} set of defenses, so it may be better than its numbers show.`);
    }
    if (defRank != null && defRank > total - SOS_NOTE_TIER) {
      notes.push(`The ${nick} defense has faced the ${scheduleText(defRank, true)} set of offenses, so its numbers may be inflated.`);
    } else if (defRank != null && defRank <= SOS_NOTE_TIER) {
      notes.push(`The ${nick} defense has faced the ${scheduleText(defRank, true)} set of offenses, so it may be better than its numbers show.`);
    }
  });
  return `${notes.length ? `<p class="explain"><strong>Schedule check:</strong> ${esc(notes.join(' '))}</p>` : ''}
    <p class="explain">The stat tables show raw numbers unless you switch Stats to Opponent-adjusted. In a 2017–2025 test, adjusting for opponents didn't predict games any better, so raw is the default.</p>`;
}

/**
 * Build one offense-vs-defense comparison table.
 * @param {string} off - Abbreviation of the team on offense.
 * @param {string} def - Abbreviation of the team on defense.
 * @returns {string} HTML for the card contents.
 */
function matchupTableHtml(off, def) {
  const { offense, defense, adjusted } = statTables();
  const o = offense[off] || {};
  const d = defense[def] || {};
  let offEdges = 0;
  let defEdges = 0;
  let bigEdges = 0;

  const rows = STATS.map((stat) => {
    const offRank = o[`${stat.key}_rank`];
    const defRank = d[`${stat.key}_rank`];
    let edge = '<span class="chip even">—</span>';
    let rowClass = '';
    if (offRank != null && defRank != null) {
      const gap = defRank - offRank;  // positive = offense ranks better
      const big = Math.abs(gap) >= BIG_EDGE_GAP;
      if (gap > 0) offEdges += 1;
      if (gap < 0) defEdges += 1;
      if (big) { bigEdges += 1; rowClass = 'big-edge'; }
      edge = gap === 0
        ? '<span class="chip even">Even</span>'
        : `<span class="chip ${gap > 0 ? 'off' : 'def'}${big ? ' big' : ''}">${esc(gap > 0 ? off : def)} +${Math.abs(gap)}</span>`;
      if (offRank <= TOP_TIER && defRank <= TOP_TIER) edge += '<br><span class="chip svs">Strength vs strength</span>';
    }
    return `<tr class="${rowClass}" title="${esc(stat.help)}">
      <td>${esc(stat.label)}</td>
      <td class="num">${fmtStat(o[stat.key], stat.fmt)}<br>${rankHtml(offRank)}</td>
      <td class="num">${fmtStat(d[stat.key], stat.fmt)}<br>${rankHtml(defRank)}</td>
      <td>${edge}</td></tr>`;
  }).join('');

  return `
    <h2>${teamBadge(off, false)} offense vs ${teamBadge(def, false)} defense</h2>
    <p class="meta">${adjusted ? '<strong>Opponent-adjusted stats.</strong> ' : ''}${esc(team(off).nick)} offense has the better rank in ${offEdges} of ${STATS.length} stats, ${esc(team(def).nick)} defense in ${defEdges}. Big edges (${BIG_EDGE_GAP}+ spots): ${bigEdges}.</p>
    <div class="table-scroll"><table>
      <thead><tr><th>Stat</th><th class="num">${esc(off)} offense</th><th class="num">${esc(def)} defense (allowed)</th><th>Edge</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="legend">
      <span><span class="chip off">Offense edge</span> <span class="chip def">Defense edge</span> +N = rank gap</span>
      <span><span class="chip off big">Outlined</span> = ${BIG_EDGE_GAP}+ spot gap (row highlighted)</span>
      <span><span class="chip svs">Strength vs strength</span> = both top ${TOP_TIER}</span>
    </div>`;
}

/**
 * League rankings: every team's offense, defense, and net EPA per play (plus
 * strength of schedule once available) in a sortable table, with the selected
 * matchup's two teams highlighted.
 * @returns {void}
 */
function renderRankings() {
  const { teams } = state.snapshot;
  const { offense, defense, adjusted } = statTables();
  const schedule = state.snapshot.schedule || {};
  const hasSchedule = Object.keys(schedule).length > 0;
  const columns = RANKING_COLUMNS.filter((c) => hasSchedule || !c.needsSchedule);
  if (!columns.some((c) => c.key === state.sort.key)) state.sort = { key: 'off', bestFirst: true };
  const { away, home } = currentSelection();

  const rows = Object.keys(teams).map((abbr) => {
    const off = offense[abbr]?.epa_per_play ?? null;
    const def = defense[abbr]?.epa_per_play ?? null;
    return {
      abbr,
      off,
      def,
      net: off == null || def == null ? null : off - def,
      offRank: offense[abbr]?.epa_per_play_rank ?? null,
      defRank: defense[abbr]?.epa_per_play_rank ?? null,
      sos: schedule[abbr]?.sos ?? null,
      sosRank: schedule[abbr]?.sos_rank ?? null,
      offSosRank: schedule[abbr]?.off_sos_rank ?? null,
      defSosRank: schedule[abbr]?.def_sos_rank ?? null,
    };
  });

  const netOrder = rows.filter((r) => r.net != null).sort((a, b) => b.net - a.net);
  netOrder.forEach((r, i) => { r.netRank = i + 1; });

  const { key, bestFirst } = state.sort;
  const column = columns.find((c) => c.key === key);
  const highFirst = column.bestHigh === bestFirst;
  rows.sort((a, b) => {
    if (a[key] == null) return 1;
    if (b[key] == null) return -1;
    return highFirst ? b[key] - a[key] : a[key] - b[key];
  });

  const header = columns.map((c) => {
    const active = c.key === key;
    const arrow = active ? (highFirst ? ' ▼' : ' ▲') : '';
    const label = c.short
      ? `<span class="name-full">${esc(c.label)}</span><span class="name-short">${esc(c.short)}</span>`
      : esc(c.label);
    return `<th class="num"><button type="button" class="sort-btn${active ? ' active' : ''}" data-sort="${c.key}">${label}${arrow}</button></th>`;
  }).join('');

  const body = rows.map((r, i) => `
    <tr class="${r.abbr === away || r.abbr === home ? 'selected' : ''}">
      <td class="pos-col">${i + 1}</td>
      <td><span class="team-badge"><span class="team-swatch" style="background:${esc(team(r.abbr).color)}"></span>
        <span class="name-full">${esc(team(r.abbr).name)}</span><span class="name-short">${esc(team(r.abbr).nick)}</span></span></td>
      <td class="num">${fmtStat(r.off, 'epa')}<br>${rankHtml(r.offRank)}</td>
      <td class="num">${fmtStat(r.def, 'epa')}<br>${rankHtml(r.defRank)}</td>
      <td class="num">${fmtStat(r.net, 'epa')}<br>${rankHtml(r.netRank ?? null)}</td>
      ${hasSchedule ? `<td class="num sched-col">
        <span class="name-full">${esc(scheduleText(r.sosRank))}</span><span class="name-short">${r.sosRank == null ? '—' : ordinal(r.sosRank)}</span><br>
        <span class="rank">O&nbsp;${r.offSosRank ?? '—'}</span> <span class="rank">D&nbsp;${r.defSosRank ?? '—'}</span></td>` : ''}
    </tr>`).join('');

  const scheduleMeta = hasSchedule
    ? `<p class="meta">Schedule (SOS, strength of schedule): how tough each team's opponents have been (1st = toughest), adjusted for who those
      opponents played. The small line ranks the defenses its offense has faced (O) and the offenses its defense
      has faced (D), also 1 = toughest. Switch Stats to Opponent-adjusted above to see EPA adjusted for it.</p>`
    : `<p class="meta">Strength of schedule appears once teams have ${SOS_MIN_WEEKS} weeks of games.</p>`;

  const view = $('rankings-view');
  view.innerHTML = `
    <h2>${adjusted ? 'Opponent-adjusted EPA' : 'EPA'} per play, week ${state.snapshot.week} snapshot (stats through week ${state.snapshot.stats_through_week})</h2>
    <p class="meta">Offense: higher is better. Defense: lower allowed is better. Net (offense minus defense allowed)
      is a quick overall strength measure. Tap a column header to re-sort; tap it again to reverse.
      Highlighted rows are the teams in your selected matchup.</p>
    ${scheduleMeta}
    <div class="table-scroll"><table class="rankings-table">
      <thead><tr><th>#</th><th>Team</th>${header}</tr></thead>
      <tbody>${body}</tbody>
    </table></div>`;

  view.querySelectorAll('.sort-btn').forEach((btn) => btn.addEventListener('click', () => {
    const clicked = btn.dataset.sort;
    state.sort = clicked === state.sort.key
      ? { key: clicked, bestFirst: !state.sort.bestFirst }
      : { key: clicked, bestFirst: true };
    renderRankings();
  }));
}

/**
 * Estimated home margin in points from a composite difference (see SPREAD_SLOPES).
 * @param {number} diff - Home composite minus away composite (EPA/play).
 * @param {string} kind - "raw" or "adj".
 * @returns {number} Projected home margin; positive = home team favored.
 */
function estimatedMargin(diff, kind) {
  const band = SPREAD_SLOPES.find((b) => state.snapshot.week <= b.lastWeek);
  return SPREAD_HOME_POINTS + band[kind] * diff;
}

/**
 * Score one composite version (raw or adjusted) for one game.
 * @param {object} game - Game from the snapshot.
 * @param {object} line - Latest recorded betting lines for the game.
 * @param {object} comp - Output of compositeSides().
 * @param {string} kind - "raw" or "adj" (picks the spread slope).
 * @returns {object|null} null when a team has no data; otherwise
 *   { diff, sides, pickTeam, margin, atsTeam, isDog, won, ats } where pickTeam
 *   has the better composite, margin is the estimated home margin, atsTeam is
 *   the side the estimated spread prefers against the betting spread, isDog
 *   means the pick is the betting underdog, and won / ats are "W", "L", "T"/"P"
 *   once the game is final (null before).
 */
function overviewVersion(game, line, comp, kind) {
  if (comp.diff == null) return null;
  const { away_team: away, home_team: home } = game;
  const pickTeam = comp.diff > 0 ? home : comp.diff < 0 ? away : null;
  const margin = estimatedMargin(comp.diff, kind);
  const spread = line.spread_line;
  const edge = spread == null ? null : margin - spread;
  const atsTeam = edge == null || edge === 0 ? null : edge > 0 ? home : away;

  let dog = null;
  if (line.home_moneyline != null && line.away_moneyline != null && line.home_moneyline !== line.away_moneyline) {
    dog = line.home_moneyline > line.away_moneyline ? home : away;
  } else if (spread) {
    dog = spread > 0 ? away : home;
  }

  let won = null;
  let ats = null;
  if (isFinal(game)) {
    const result = game.home_score - game.away_score;
    if (pickTeam) won = result === 0 ? 'T' : (result > 0) === (pickTeam === home) ? 'W' : 'L';
    if (atsTeam) {
      const cover = result - spread;
      ats = cover === 0 ? 'P' : (cover > 0) === (atsTeam === home) ? 'W' : 'L';
    }
  }
  return { diff: comp.diff, sides: comp.sides, pickTeam, margin, atsTeam, isDog: pickTeam != null && pickTeam === dog, won, ats };
}

/**
 * Count wins, losses, and ties/pushes for one result field across games.
 * @param {Array<object|null>} versions - overviewVersion() results.
 * @param {string} field - "won" or "ats".
 * @returns {string|null} e.g. "9-6" or "7-7-1", or null if no game is final.
 */
function recordText(versions, field) {
  const results = versions.map((v) => v?.[field]).filter(Boolean);
  if (!results.length) return null;
  const count = (r) => results.filter((x) => x === r).length;
  const draws = count('T') + count('P');
  return `${count('W')}-${count('L')}${draws ? `-${draws}` : ''}`;
}

/**
 * Weekly overview: every game of the week with lines, raw and opponent-adjusted
 * composites, estimated spreads, underdog flags, and results, in a sortable table.
 * Tapping a game opens it in the Matchup view.
 * @returns {void}
 */
function renderOverview() {
  const snap = state.snapshot;
  const adjAvailable = hasAdjusted();
  if (state.overviewSort.key === 'adj' && !adjAvailable) state.overviewSort = { key: 'kickoff', reversed: false };

  const rows = snap.games.map((game) => {
    const { away_team: away, home_team: home } = game;
    const line = latestLine(game);
    const raw = overviewVersion(game, line, compositeSides(away, home, snap.offense, snap.defense), 'raw');
    const adj = adjAvailable
      ? overviewVersion(game, line, compositeSides(away, home, snap.offense_adj, snap.defense_adj), 'adj')
      : null;
    const homeChance = homeWinChance(line);
    return {
      game, line, raw, adj,
      sort: {
        kickoff: `${game.gameday} ${game.gametime || '99:99'} ${game.game_id}`,
        spread: line.spread_line == null ? null : Math.abs(line.spread_line),
        total: line.total_line ?? null,
        ml: homeChance == null ? null : Math.max(homeChance, 1 - homeChance),
        raw: raw ? Math.abs(raw.diff) : null,
        adj: adj ? Math.abs(adj.diff) : null,
      },
    };
  });

  const { key, reversed } = state.overviewSort;
  const highFirst = OVERVIEW_SORTS[key].firstHigh !== reversed;
  rows.sort((a, b) => {
    const x = a.sort[key];
    const y = b.sort[key];
    if (x == null) return 1;
    if (y == null) return -1;
    if (x === y) return 0;
    return (x > y ? 1 : -1) * (highFirst ? -1 : 1);
  });

  const sortBtn = (k) => {
    const active = k === key;
    const arrow = active ? (highFirst ? ' ▼' : ' ▲') : '';
    return `<button type="button" class="sort-btn${active ? ' active' : ''}" data-sort="${k}">${esc(OVERVIEW_SORTS[k].label)}${arrow}</button>`;
  };

  const resultChips = (v) => {
    const chips = [];
    if (v.isDog) chips.push('<span class="chip lean">Dog</span>');
    if (v.won) chips.push({ W: '<span class="chip off">Won</span>', L: '<span class="chip def">Lost</span>', T: '<span class="chip even">Tie</span>' }[v.won]);
    if (v.ats) chips.push({ W: '<span class="chip off">ATS W</span>', L: '<span class="chip def">ATS L</span>', P: '<span class="chip even">ATS push</span>' }[v.ats]);
    return chips.length ? `<span class="sub result-chips">${chips.join(' ')}</span>` : '';
  };

  const versionCell = (v, game) => {
    if (!v) return '<td class="num">—</td>';
    const { away_team: away, home_team: home } = game;
    const edge = v.pickTeam ? `${v.pickTeam} +${Math.abs(v.diff).toFixed(3)}` : 'Even';
    return `<td class="num"><strong>${esc(edge)}</strong>
      <span class="sub">≈ ${esc(spreadText(Number(v.margin.toFixed(1)), away, home))}</span>
      <span class="sub">${esc(away)} ${signed(v.sides[0].value, 3)}</span>
      <span class="sub">${esc(home)} ${signed(v.sides[1].value, 3)}</span>
      ${resultChips(v)}</td>`;
  };

  const body = rows.map(({ game, line, raw, adj }) => {
    const { away_team: away, home_team: home } = game;
    const final = isFinal(game)
      ? `<span class="sub"><span class="name-full">Final: ${esc(away)} ${game.away_score} – ${esc(home)} ${game.home_score}</span><span class="name-short">Final ${game.away_score}–${game.home_score}</span></span>`
      : '';
    const kickoff = kickoffText(game);
    const tags = [injuryTags(away), injuryTags(home)].filter(Boolean).join(' ');
    return `<tr class="clickable${game.game_id === state.gameId ? ' selected' : ''}" data-game="${esc(game.game_id)}" tabindex="0">
      <td><span class="name-full">${teamBadge(away, false)} @ ${teamBadge(home, false)}</span>
        <span class="name-short">${esc(away)}<br>@ ${esc(home)}</span>
        <span class="sub"><span class="name-full">${esc(kickoff)}</span><span class="name-short">${esc(kickoff.replace(/ \d+\/\d+ ·/, '').replace(' ET', ''))}</span></span>${final}
        ${tags ? `<span class="sub result-chips">${tags}</span>` : ''}</td>
      <td class="num"><strong>${esc(spreadText(line.spread_line, away, home))}</strong>
        <span class="sub">O/U ${line.total_line ?? '—'}</span>
        <span class="sub">${esc(away)} ${fmtMoneyline(line.away_moneyline)}</span>
        <span class="sub">${esc(home)} ${fmtMoneyline(line.home_moneyline)}</span></td>
      ${versionCell(raw, game)}
      ${adjAvailable ? versionCell(adj, game) : ''}
    </tr>`;
  }).join('');

  const rawSu = recordText(rows.map((r) => r.raw), 'won');
  const rawAts = recordText(rows.map((r) => r.raw), 'ats');
  const adjSu = recordText(rows.map((r) => r.adj), 'won');
  const adjAts = recordText(rows.map((r) => r.adj), 'ats');
  let record = '';
  if (rawSu || rawAts) {
    record = `<p class="meta"><strong>Finished games:</strong> raw composite picks went ${rawSu ?? '—'} straight up and ${rawAts ?? '—'} against the spread`;
    record += adjAvailable ? `; opponent-adjusted went ${adjSu ?? '—'} and ${adjAts ?? '—'}.</p>` : '.</p>';
  }
  const dogs = rows.filter((r) => r.raw?.isDog).length;

  const view = $('overview-view');
  view.innerHTML = `
    <h2>Week ${snap.week} overview (stats through week ${snap.stats_through_week})</h2>
    <p class="meta">Every game this week. Tap a column name to sort (tap again to reverse), or tap a game to open it.
      The raw composite favors the betting underdog in ${dogs} game${dogs === 1 ? '' : 's'} (tagged Dog).</p>
    ${record}
    <div class="table-scroll"><table class="overview-table">
      <thead><tr>
        <th>${sortBtn('kickoff')}</th>
        <th class="num">${sortBtn('spread')}<br>${sortBtn('total')}<br>${sortBtn('ml')}</th>
        <th class="num">${sortBtn('raw')}</th>
        ${adjAvailable ? `<th class="num">${sortBtn('adj')}</th>` : ''}
      </tr></thead>
      <tbody>${body}</tbody>
    </table></div>
    <div class="footnote">
      <p><strong>Lines:</strong> the latest recorded spread, over/under, and moneylines (for past weeks, the last line
        before kickoff). ML sorts by how big a favorite the favorite is.</p>
      <p><strong>Composite:</strong> for each offense, the average of its EPA per play and what the opposing defense
        allows. The bold number is the team with the better composite and by how much; the two small numbers are each
        team's composite. Opponent-adjusted uses stats adjusted for the opponents each team has faced${adjAvailable ? '' : ` (it appears once teams have ${SOS_MIN_WEEKS} weeks of games)`}.</p>
      <p><strong>≈ spread:</strong> the composite turned into an estimated point spread, including about
        ${SPREAD_HOME_POINTS} points for home field, using how composites translated into final margins in 2017–2025.
        Early in the season composites are noisy, so the same gap is worth fewer points.</p>
      <p><strong>Dog:</strong> the composite's pick is the betting underdog. <strong>Won / Lost:</strong> whether the
        team with the better composite won. <strong>ATS:</strong> whether the side its estimated spread prefers
        covered the betting spread (e.g. estimated NO -0.6 vs betting NO -1.5 means ATL +1.5).</p>
      <p><strong>Injury tags:</strong> key players (starters) who are out, doubtful, on IR/PUP, or sat last game
        before this week's report is filed ("out"), or
        questionable ("Q"). Open a game for names, injuries, and who's next up.</p>
      <p>For interest, not picks: in 2017–2025 testing, neither version beat the betting market, and against the
        spread they won about half the time.</p>
    </div>`;

  view.querySelectorAll('.sort-btn').forEach((btn) => btn.addEventListener('click', () => {
    const clicked = btn.dataset.sort;
    state.overviewSort = clicked === state.overviewSort.key
      ? { key: clicked, reversed: !state.overviewSort.reversed }
      : { key: clicked, reversed: false };
    renderOverview();
  }));
  view.querySelectorAll('tr.clickable').forEach((tr) => {
    tr.addEventListener('click', () => openGame(tr.dataset.game));
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') openGame(tr.dataset.game); });
  });
}

/**
 * Open one of this week's games in the Matchup view (used by the weekly overview).
 * @param {string} gameId - nflverse game_id.
 * @returns {void}
 */
function openGame(gameId) {
  state.mode = 'game';
  state.gameId = gameId;
  $('game-select').value = gameId;
  document.querySelectorAll('#mode-toggle button').forEach((b) => b.classList.toggle('active', b.dataset.mode === 'game'));
  setView('matchup');
  window.scrollTo(0, 0);
}

/**
 * Fill the "How to read this page" section (only needs to run once).
 * @returns {void}
 */
function renderGlossary() {
  const box = $('glossary');
  if (box.dataset.filled) return;
  box.dataset.filled = '1';
  box.innerHTML = `
    <p><strong>Ranks:</strong> 1 = best for that side, out of 32. For a defense, best means it allowed the least,
      except sack rate, QB hit rate, and turnover rate, where 1 = forced the most. So in every row, the smaller
      rank number has the edge.</p>
    <p><strong>Edge:</strong> the side with the better rank, and by how many spots. Gaps of ${BIG_EDGE_GAP}+ are
      highlighted. "Strength vs strength" means both sides rank in the top ${TOP_TIER}, so neither is likely to
      dominate.</p>
    <p><strong>Snapshots:</strong> each week uses only stats from earlier weeks, so past weeks show what the numbers
      said before kickoff. Hover over or long-press a row to see what the stat means.</p>
    <p><strong>Strength of schedule:</strong> how good a team's opponents have been, measured by their EPA per play
      after adjusting for who <em>they</em> played. "Defenses its offense has faced" is about the offense's opponents;
      "Offenses its defense has faced" is about the defense's. It appears after ${SOS_MIN_WEEKS} weeks.</p>
    <p><strong>Raw vs opponent-adjusted:</strong> raw stats are exactly what each team has done. Opponent-adjusted
      stats give credit for facing good opponents and take some away for facing weak ones (every team's rating is
      worked out together, so opponents are adjusted too). Use the Stats toggle to switch the matchup tables and
      league rankings. Raw is the default because, in a 2017–2025 test, adjusted numbers picked winners slightly less
      often, especially early in the season. The game script, pace, and records always use raw numbers.</p>
    <p><strong>Key injuries:</strong> starters (1st string on the depth chart, or at least half of the snaps) who are
      Out, Doubtful, Questionable, or on IR/PUP, with the injury, practice status, and the next healthy player at
      that spot. The stats don't adjust for injuries, so a missing starter is extra information on top of them.
      Statuses settle on Friday; the data is refreshed Thursday and Saturday. Until a team files its report,
      starters who were Out or Doubtful last game and didn't play are shown as "Out last game".</p>
    <dl>${STATS.map((s) => `<dt>${esc(s.label)}</dt><dd>${esc(s.help)}</dd>`).join('')}</dl>`;
}

// ----------------------------------------------------------------------
// Start-up and event wiring
// ----------------------------------------------------------------------

/**
 * Switch between picking a scheduled game and picking any two teams.
 * @param {string} mode - "game" or "manual".
 * @returns {void}
 */
function setMode(mode) {
  if (mode === 'manual' && state.mode === 'game') {
    const game = state.snapshot.games.find((g) => g.game_id === state.gameId);
    if (game) {
      $('away-select').value = game.away_team;
      $('home-select').value = game.home_team;
    }
  }
  state.mode = mode;
  document.querySelectorAll('#mode-toggle button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  $('game-picker').classList.toggle('hidden', mode !== 'game');
  $('team-picker').classList.toggle('hidden', mode !== 'manual');
  render();
}

/**
 * Switch between the matchup, league rankings, and weekly overview views.
 * The week picker stays visible in all of them; the game/team pickers only
 * show in the matchup view, but the selection is kept for highlighting. The
 * Raw / Opponent-adjusted toggle is hidden in the overview, which shows both.
 * @param {string} view - "matchup", "rankings", or "overview".
 * @returns {void}
 */
function setView(view) {
  state.view = view;
  const matchup = view === 'matchup';
  document.querySelectorAll('#view-toggle button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $('mode-field').classList.toggle('hidden', !matchup);
  $('stats-field').classList.toggle('hidden', view === 'overview');
  $('game-picker').classList.toggle('hidden', !matchup || state.mode !== 'game');
  $('team-picker').classList.toggle('hidden', !matchup || state.mode !== 'manual');
  $('matchup').classList.toggle('hidden', !matchup);
  $('rankings-view').classList.toggle('hidden', view !== 'rankings');
  $('overview-view').classList.toggle('hidden', view !== 'overview');
  render();
}

/**
 * Load the week list, show the current week, and hook up the controls.
 * @returns {Promise<void>}
 */
async function init() {
  try {
    state.index = await fetchJson('data/weeks.json');
    if (!state.index.weeks.length) throw new Error('No weekly data yet. Run nfl_team_stats.py after week 1.');
    const week = fillWeekSelect();
    await loadWeek(week);
  } catch (error) {
    const hint = location.protocol === 'file:'
      ? ' Browsers block data files on pages opened straight from disk: run "python -m http.server" in this folder and open http://localhost:8000.'
      : '';
    $('updated-label').textContent = 'Could not load data.';
    $('error-box').textContent = `${error.message}${hint}`;
    $('error-box').classList.remove('hidden');
    return;
  }

  $('week-select').addEventListener('change', (e) => loadWeek(e.target.value));
  $('game-select').addEventListener('change', (e) => { state.gameId = e.target.value; render(); });
  $('away-select').addEventListener('change', render);
  $('home-select').addEventListener('change', render);
  $('swap-btn').addEventListener('click', () => {
    const away = $('away-select').value;
    $('away-select').value = $('home-select').value;
    $('home-select').value = away;
    render();
  });
  document.querySelectorAll('#mode-toggle button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  document.querySelectorAll('#view-toggle button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  document.querySelectorAll('#stats-toggle button').forEach((b) => b.addEventListener('click', () => setStats(b.dataset.stats)));
}

init();
