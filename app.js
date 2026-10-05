/**
 * NFL Matchup Analyzer - page logic.
 *
 * Summary:
 *   Loads the weekly snapshot list (data/weeks.json), then the chosen week's
 *   snapshot, and builds the page: game header and final result, betting
 *   lines and line movement, a composite EPA projection for each offense,
 *   context (Pythagorean record, pace, rest, roof), and two stat-by-stat
 *   tables (away offense vs home defense, home offense vs away defense).
 *   A separate "League rankings" view lists every team's offense, defense,
 *   and net EPA per play in a sortable table.
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
];

const state = {
  index: null,
  snapshot: null,
  view: 'matchup',
  mode: 'game',
  gameId: null,
  sort: { key: 'off', bestFirst: true },
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
 * Composite projection: average of offense EPA/play and opposing defense EPA/play allowed.
 * @param {string} away - Away team abbreviation.
 * @param {string} home - Home team abbreviation.
 * @param {object|null} game - Scheduled game (used to compare with a final score).
 * @returns {void}
 */
function renderComposite(away, home, game) {
  const { offense, defense } = state.snapshot;
  const sides = [[away, home], [home, away]].map(([off, def]) => {
    const o = offense[off]?.epa_per_play;
    const d = defense[def]?.epa_per_play;
    return { off, def, o, d, value: o == null || d == null ? null : (o + d) / 2 };
  });

  const tiles = sides.map((s) => `
    <div class="tile">
      <div class="label">${esc(team(s.off).nick)} offense vs ${esc(team(s.def).nick)} defense</div>
      <div class="value ${s.value > 0 ? 'pos' : s.value < 0 ? 'neg' : ''}">${s.value == null ? '—' : signed(s.value, 3)} EPA/play</div>
      <div class="detail">${esc(s.off)} offense ${fmtStat(s.o, 'epa')} (${ordinal(offense[s.off]?.epa_per_play_rank ?? 0)}) ·
        ${esc(s.def)} defense allows ${fmtStat(s.d, 'epa')} (${ordinal(defense[s.def]?.epa_per_play_rank ?? 0)})</div>
    </div>`).join('');

  let verdict = '';
  const [a, h] = sides;
  if (a.value != null && h.value != null) {
    const diff = h.value - a.value;
    const better = diff > 0 ? h : a;
    verdict = Math.abs(diff) < 0.005
      ? 'The two offenses project about the same in this matchup.'
      : `The ${team(better.off).nick}' offense has the stronger matchup by ${Math.abs(diff).toFixed(3)} EPA per play.`;
    if (game && isFinal(game)) {
      const margin = game.home_score - game.away_score;
      const winner = margin > 0 ? home : margin < 0 ? away : null;
      verdict += winner
        ? ` Result: the ${team(winner).nick} won${winner === better.off ? ', matching the composite' : ', against the composite'}.`
        : ' Result: tie.';
    }
  }

  $('composite-card').innerHTML = `
    <h2>Composite matchup</h2>
    <div class="tiles">${tiles}</div>
    <p class="explain"><strong>${esc(verdict)}</strong></p>
    <p class="explain">Each number averages how well the offense has moved the ball (EPA per play) with how much the opposing defense usually gives up, so a higher number means that offense should have an easier time.</p>`;
}

/**
 * Context: record vs Pythagorean expectation (luck gap), pace, rest, and roof.
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
    <p class="explain">Pythagorean win % is the record a team "should" have from its points scored and allowed. A big positive luck gap means it has won more than its scoring suggests (often close games) and may cool off; a big negative gap suggests it's better than its record.</p>`;
}

/**
 * Build one offense-vs-defense comparison table.
 * @param {string} off - Abbreviation of the team on offense.
 * @param {string} def - Abbreviation of the team on defense.
 * @returns {string} HTML for the card contents.
 */
function matchupTableHtml(off, def) {
  const o = state.snapshot.offense[off] || {};
  const d = state.snapshot.defense[def] || {};
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
    <p class="meta">${esc(team(off).nick)} offense has the better rank in ${offEdges} of ${STATS.length} stats, ${esc(team(def).nick)} defense in ${defEdges}. Big edges (${BIG_EDGE_GAP}+ spots): ${bigEdges}.</p>
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
 * League rankings: every team's offense, defense, and net EPA per play in a
 * sortable table, with the selected matchup's two teams highlighted.
 * @returns {void}
 */
function renderRankings() {
  const { offense, defense, teams } = state.snapshot;
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
    };
  });

  const netOrder = rows.filter((r) => r.net != null).sort((a, b) => b.net - a.net);
  netOrder.forEach((r, i) => { r.netRank = i + 1; });

  const { key, bestFirst } = state.sort;
  const column = RANKING_COLUMNS.find((c) => c.key === key);
  const highFirst = column.bestHigh === bestFirst;
  rows.sort((a, b) => {
    if (a[key] == null) return 1;
    if (b[key] == null) return -1;
    return highFirst ? b[key] - a[key] : a[key] - b[key];
  });

  const header = RANKING_COLUMNS.map((c) => {
    const active = c.key === key;
    const arrow = active ? (highFirst ? ' ▼' : ' ▲') : '';
    return `<th class="num"><button type="button" class="sort-btn${active ? ' active' : ''}" data-sort="${c.key}">${esc(c.label)}${arrow}</button></th>`;
  }).join('');

  const body = rows.map((r, i) => `
    <tr class="${r.abbr === away || r.abbr === home ? 'selected' : ''}">
      <td class="pos-col">${i + 1}</td>
      <td><span class="team-badge"><span class="team-swatch" style="background:${esc(team(r.abbr).color)}"></span>
        <span class="name-full">${esc(team(r.abbr).name)}</span><span class="name-short">${esc(team(r.abbr).nick)}</span></span></td>
      <td class="num">${fmtStat(r.off, 'epa')}<br>${rankHtml(r.offRank)}</td>
      <td class="num">${fmtStat(r.def, 'epa')}<br>${rankHtml(r.defRank)}</td>
      <td class="num">${fmtStat(r.net, 'epa')}<br>${rankHtml(r.netRank ?? null)}</td>
    </tr>`).join('');

  const view = $('rankings-view');
  view.innerHTML = `
    <h2>EPA per play, week ${state.snapshot.week} snapshot (stats through week ${state.snapshot.stats_through_week})</h2>
    <p class="meta">Offense: higher is better. Defense: lower allowed is better. Net (offense minus defense allowed)
      is a quick overall strength measure. Tap a column header to re-sort; tap it again to reverse.
      Highlighted rows are the teams in your selected matchup.</p>
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
 * Switch between the matchup view and the league rankings view.
 * The week picker stays visible in both; the game/team pickers are hidden
 * in rankings view, but the selection is kept for highlighting.
 * @param {string} view - "matchup" or "rankings".
 * @returns {void}
 */
function setView(view) {
  state.view = view;
  const rankings = view === 'rankings';
  document.querySelectorAll('#view-toggle button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $('mode-field').classList.toggle('hidden', rankings);
  $('game-picker').classList.toggle('hidden', rankings || state.mode !== 'game');
  $('team-picker').classList.toggle('hidden', rankings || state.mode !== 'manual');
  $('matchup').classList.toggle('hidden', rankings);
  $('rankings-view').classList.toggle('hidden', !rankings);
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
}

init();
