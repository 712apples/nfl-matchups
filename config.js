/**
 * NFL Matchup Analyzer - site settings (support link, visitor counter, DraftKings link).
 *
 * Summary:
 *   The only file to edit when turning money-making features on or off.
 *   Paste a value between the quotes to turn a feature on; leave it as ''
 *   to keep it hidden. app.js reads these settings when the page opens.
 *   - tipUrl: your Ko-fi / Buy Me a Coffee page. Shows a "support" link at
 *     the bottom of every page.
 *   - goatcounterCode: the code from your GoatCounter site address
 *     (for https://nflmatchups.goatcounter.com the code is 'nflmatchups').
 *     Counts visits and which view (Matchup, Fantasy, ...) people open.
 *     Visits from your own computer while testing (localhost) aren't counted.
 *   - dfsUrl: your DraftKings (or other DFS site) referral/affiliate link.
 *     Shows a link on the Fantasy page with the required disclosure.
 *   After editing, commit and push the nfl-matchups folder as usual. The app
 *   may need to be opened twice before the change shows (it updates in the
 *   background).
 *
 * Input files: None.
 * Output files: None. Defines SITE_CONFIG, used by app.js.
 *
 * Location: D:\OneDrive\Code\DFS_direct\NFL\nfl-matchups\config.js
 */

const SITE_CONFIG = {
  tipUrl: 'https://ko-fi.com/jumangibutter',
  tipLabel: 'Buy me a coffee',
  goatcounterCode: 'datacruncher',
  dfsUrl: '',
  dfsLabel: 'Play this week on DraftKings',
};
