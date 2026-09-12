# Notion backup before the game design meeting update (2026-09-11)

Exact text of the Larp City Notion blocks that were edited to reflect the 2026-09-11 game design meeting.
The update only edited these blocks and added new ones; nothing was deleted, and Notion's page history keeps the full earlier version.

| Section | Block id | Text before the edit |
| --- | --- | --- |
| Core Features | 14e9e716-69c3-4652-877f-e07e7d0faf12 | **Weekly calendar:** the simulation advances one week per tick, and seasons and the city change over time. |
| Core Features | bd2f7406-6c13-43a9-b42d-002fad4b3451 | **~50 NPCs with bank accounts:** persistent preloaded data with reset options; NPC personalities react to the same events. |
| Stock Market & Simulation | 9dc138a8 | **Time:** 1 tick = 1 week, with speeds from 2 s down to 0.25 s per week; a 10-minute demo covers about 20 years with about 6 decision pauses. |

## Mystery Year removal (later the same night)

The team cut the "Mystery Year" historical market mode.
Blocks deleted or edited in Notion, with their text before the change:

| Where | Block id | Before | Change |
| --- | --- | --- | --- |
| Stock Market & Simulation | a524a15b-ecd8-4582-ab34-d715cc6c7753 | **Optional "Mystery Year" mode:** replay real weekly returns (Kenneth French data, 1926 to now) with the year hidden, revealed at the end. | Deleted |
| Open Questions | c38f8c1e-39ec-458e-a18e-b29e624508b8 | Is "Mystery Year" (stock market play real historical event instead of simulation) historical mode a stretch goal or cut? | Checked off, "Cut on Sep 11" appended (teammate wording kept) |
| ChatGPT Brief | f4bd640d-d721-4e81-9784-e47f0f7e53d9 | **Data:** Don't bundle the S&P 500 series (licensing) or Yahoo (personal-use only). Kenneth French's weekly market returns (1926 to now) plus FRED bond, T-bill, and CPI series can power an optional "Mystery Year" historical mode, at about 200 KB of JSON. | Second sentence removed |
| Research: Stock Market | e991191b | Keep an optional "Mystery Year" historical mode that replays real weekly returns from the Fama/French weekly data with the year hidden, revealed at the end. | Deleted |
| Research: Stock Market | 84367265 | Bundling plan: a Python script pulls the Fama/French weekly CSV and FRED DGS10 / TB3MS / CPIAUCSL, and writes public/data/market-weekly.json. | Deleted; this block also held the bond-return approximation and "Credit the sources in the About screen", which were re-added as two new blocks after the data-source table |
| Research: Stock Market | 584c4c0e-3ed3-48b1-bd14-d06b4c0e91cc (Kenneth French table row) | Verdict: **Best choice** for historical mode. | Now "Best choice for real historical returns" |
| Research: Stock Market | 7148058c-3515-48ee-96f3-303803d46cea | Historical "Mystery Year" mode (stretch): swap the generated MarketPath for real Fama/French weekly returns from a random start week, reveal the year at the end. Same engine, different path source. | Deleted |
| Research: Stock Market | 29b3129f-f78f-4b02-9a2e-af2382484ca9 | Is "Mystery Year" historical mode a stretch goal or cut? The data pipeline takes about an hour. | Deleted |

Open questions "Pace of time: weekly vs monthly", "one life with ~49 NPCs or all 50", and "starting age and time span, is retirement in scope" were already checked off by the team before this update.
