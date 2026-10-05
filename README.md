# NFL Matchup Analyzer

Pick any NFL game (or any two teams) and see each offense stacked up against the opposing defense, stat by stat, with ranks, edges, a simple EPA projection, betting lines, and how those lines moved during the week.

**[Open the app](https://712apples.github.io/nfl-matchups/)**

## Features

- **Week picker:** every week of the season is saved as a snapshot, so you can go back and see what the numbers said before kickoff
- **Scheduled game or any two teams**, with a swap button for home and away
- **Two matchup tables:** away offense vs home defense, and home offense vs away defense, with 15 stats each
- **Edges:** the side with the better rank in each stat, highlighted when the gap is 8+ spots, and tagged "strength vs strength" when both rank in the top 10
- **Composite projection:** the average of the offense's EPA per play and what the opposing defense allows
- **Context:** record, Pythagorean win % and luck gap, points per game, pace, rest days, and roof
- **Betting lines:** spread, total, moneylines, and the market's implied win chance
- **Line movement:** each time the data is refreshed during the week, line changes are recorded and explained in plain English
- **Final results** for finished games: score, who covered, and over/under
- **Installs on your phone** and works offline

## Install on your phone

- **iPhone:** open the link in Safari, tap **Share**, then **Add to Home Screen**.
- **Android:** open the link in Chrome, tap the **⋮** menu, then **Install app**.

## Where the data comes from

Free [nflverse](https://github.com/nflverse) play-by-play, downloaded by `nfl_team_stats.py` with the `nflreadpy` library. Only regular-season pass and run plays count, and garbage time (win probability under 5% or over 95%) is removed.

The snapshot for week N uses stats through week N−1 only. Ranks run 1 to 32 where 1 is best for that side; for defenses, 1 means allowed the least, except sacks, QB hits, and turnovers, where 1 means forced the most.

## Weekly refresh

```powershell
cd D:\OneDrive\Code\DFS_direct\NFL
python nfl_team_stats.py
cd nfl-matchups
git add data
git commit -m "Update data"
git push
```

GitHub Pages republishes the site about a minute after the push. Running the script again later in the week records any line movement.

## Notes

- Early-season ranks are based on very few games and can swing a lot from week to week.
- Weeks rebuilt after the fact (the first time the script ran) show closing lines.
- Stats, not betting advice. Please bet responsibly.
