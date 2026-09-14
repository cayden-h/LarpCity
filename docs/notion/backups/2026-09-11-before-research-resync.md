# Notion backup - research sub-pages, before re-syncing them from the local docs (2026-09-11)

Parent page: https://app.notion.com/p/Larp-City-3d846cd8aa24804a9c63c8bfc95a5e6b

The research sub-pages are mirrors of the local markdown in `research/`.
Several local docs changed after they were first mirrored (the game design meeting, the MLH plan, the debt engine), so each sub-page whose text differs from its local file has its body replaced with a fresh render of that file.
Before replacing anything, every block on these pages was checked: all were created and last edited by Cayden's account through the API (0 blocks by teammates), so no teammate content is affected.
The old bodies are still available in Notion's page history.

| Local file | Notion sub-page | Page id | Blocks before |
| --- | --- | --- | --- |
| research/SUMMARY.md | ChatGPT Brief (Research Summary) | 8ea1ead8-f511-448b-88b6-73b96458d319 | 100 |
| research/01-avatar-and-persona.md | Research: Avatar & Persona | 6686facf-be18-4414-88d2-874fb89dfadf | 135 |
| research/02-states-cost-of-living.md | Research: States & Cost of Living | 1ffd7352-31b1-40d3-9e7f-c7b53c39fc9b | 154 |
| research/03-stock-market-and-simulation.md | Research: Stock Market & Simulation | 72b223ee-ed2b-413d-9028-7a7c53be387e | 233 |
| research/04-impact-learning-and-judging.md | Research: Impact, Learning & Judging | d9b9edfc-337c-4632-808c-a9d69f9463ce | 175 |
| research/05-city-visuals-and-art-pipeline.md | Research: City Visuals & Art Pipeline | b2ad33e6-8b82-45d4-8766-93377d8e6236 | 190 |
| research/06-debt-and-credit.md | Research: Debt & Credit | 0a47e3a0-4c71-43ae-9937-0bb6d8bd4d51 | - |

`research/07-debt-system-design.md` is mirrored with its five uploaded diagrams and is left as is (only its promo APR sentence was updated in place).

Result: all seven pages differed from their local files, so all seven were re-rendered (new top-level blocks: SUMMARY 118, 01 94, 02 101, 03 152, 04 96, 05 125, 06 159); every write returned 200 and the old top-level blocks were archived.
