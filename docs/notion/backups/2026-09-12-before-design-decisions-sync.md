# Notion backup - before the design decisions sync (2026-09-12)

Page: https://app.notion.com/p/Larp-City-3d846cd8aa24804a9c63c8bfc95a5e6b
Page id `3d846cd8-aa24-804a-9c63-c8bfc95a5e6b`, space `43555b91-61bf-4007-a4b1-b8753c13b872`, role editor.

This sync mirrors the 2026-09-12 follow-up decisions from `meeting-2026-09-11-game-design.md`: speed controls, the Calendar app, unlimited rewind with branches and ghost lines, skip to next event, news during skips, scoring for learning, the preset AI Boom and AI Bubble Pop, fast-forward to goals (the age teleport is removed), and the onboarding inputs.
It also adds the research/09 and research/10 sub-pages and re-syncs the research mirrors whose local files changed.
Nothing written by teammates is deleted; their open questions are checked off with an answer appended, and their wording is kept.
Full text history is in Notion's page history.

## Main page blocks edited in place (text before the edit)

| Section | Block id | Type | Text before the edit |
| --- | --- | --- | --- |
| 🕹️ Core Features | 14e9e716-69c3-4652-877f-e07e7d0faf12 | bulleted_list | Daily calendar: time ticks day by day (Stardew Valley style) at 1 in-game week every 10 real seconds (about 1.4 s per day). Skip to the next day, week, month, or event; seasons and the city change over time. |
| 🕹️ Core Features | 3fa78e5e-857c-4d0f-8cc3-9fe5f840a251 | bulleted_list | Age teleport: jump to a future age (for example 24 to 60) using annual contribution, return rate, and bond allocation; bankruptcy along the way stops the jump and explains why. |
| 🕹️ Core Features | d014ef43-18f2-4ee5-b50b-019b53da886e | bulleted_list | Replay/rewind: revisit a decision and try the other choice on the same market path. |
| 🗓️ Game Design Meeting (Sep 11) | 7b9f4eab-2158-4bc7-90c4-cc3ac56df4e6 | bulleted_list | Daily pacing (Stardew Valley style) at 1 in-game week every 10 real seconds: about 1.4 s per day and 8.7 min per year, so decades are covered by skipping. |
| 🗓️ Game Design Meeting (Sep 11) | 36baca4b-93d5-415c-a83c-6452bee22d46 | bulleted_list | Skips: next day, week, or month, plus "Skip to next event" so players don't miss live events. |
| 🗓️ Game Design Meeting (Sep 11) | 2dfe4ecc-ff45-42e1-a468-aee9f9d04ade | bulleted_list | Age teleport: jump to a future age (for example 24 to 60) using annual contribution, return rate, and bond allocation; the event system still runs during the jump. |
| 🗓️ Game Design Meeting (Sep 11) | a962043e-062b-4fb9-9d54-9fc1f3c11d3b | bulleted_list | Bankruptcy stops the jump at that year, explains why, and shows the stock portfolio and housing situation at that moment. |
| 🗓️ Game Design Meeting (Sep 11) | 054e03f0-1122-4260-b7c9-fc9bd8cb6029 | to_do (unchecked) | Define the event system (gacha/random events) and how it works with time skips, the age teleport, and goal skips. |
| 🗓️ Game Design Meeting (Sep 11) | f9f1e2e1-701e-4076-8520-1dcfa6cb43e1 | to_do (unchecked) | Decide whether there are faster run speeds beyond 1 week per 10 s, or whether the skip buttons cover it. |
| 🎨 City Visuals & Traffic | 423699d9-2add-4b33-9827-44c31f35929d | bulleted_list | Daily calendar (from the meeting): the calendar runs 1 game week per 10 real seconds (about 1.4 s per day), so the sky runs its own 72-second day/night cycle. Skips and the age teleport play as a time-lapse where the city visibly ages. |
| 🎨 City Visuals & Traffic | 3e875d38-05f2-4ef2-b97d-847b38ee1114 | bulleted_list | Pacing: the calendar runs 1 week per 10 s (from the meeting), so the sky runs its own 72-second day, and skips play as a time-lapse. |
| 📈 Stock Market & Simulation | 9dc138a8-c985-4439-b2e3-02d65784f513 | bulleted_list | Time: 1 tick = 1 day, and normal speed is 1 in-game week every 10 real seconds; skips (next day/week/month/event, until a goal, teleport to an age) cover the decades. The weekly calibration converts to daily: drift ÷ 5, volatility ÷ √5. |
| 💳 Debt & Credit | bd5426d4-2f84-4794-be03-7c5ca817491e | bulleted_list | Age teleport gets a debt strategy input (minimums, snowball, or avalanche plus an extra amount), and "become debt-free" is a goal, so AI feedback stays at the meeting's three triggers. |
| 🔌 Setup & API Keys | 468ed42e-0f87-4242-bb0c-54ad326eaac8 | bulleted_list | Age teleport posts one summary transaction after the jump, not every day |
| 🔌 Setup & API Keys | 33d8534c-88b2-40b3-a9c2-84ac6d9250e9 | numbered_list | Leaderboard = latest snapshot per run; rewind and milestone replay = WHERE day <= N. |
| 🔌 Setup & API Keys | 6e2d24f2-6dfd-4086-85ea-47c766e73b88 | bulleted_list | Rewind, bankruptcy look-back, retirement milestone replay |
| ❓ Open Questions | 6a49d930-ba94-43ae-8da2-7614db04adaa | to_do (unchecked) | How should random timelines and events be implemented? |
| ❓ Open Questions | f4d0bb09-46a6-4244-8431-e785079a41a4 | to_do (unchecked) | Is the score net worth at a fixed age, citizens kept housed, or a mix with a wellbeing meter? |
| ❓ Open Questions | bc3f3d21-a9b3-40cf-a355-84830656452a | to_do (unchecked) | Free rewind at any decision, or limited "rewind tokens"? |
| ❓ Open Questions | d8361ddf-6bf1-4893-a608-63e3d2e662e0 | to_do (unchecked) | Curate demo seeds so an AI Bubble Pop and a crash happen by minute 5? |

## Blocks added to the main page

- "🗓️ Game Design Meeting (Sep 11)" (`589787e2-a271-4050-a7cf-132c8b6404a2`): a "Follow-up decisions (Sep 12)" heading and its bullets, inserted after `a57577c4` (the cost-of-living tiers bullet), before "Next steps".
- "🕹️ Core Features" (`785b9f53-1012-4a83-9645-cdbb96667976`): bullets for the Calendar app, the score, and the onboarding inputs, inserted after `d014ef43`.
- "❓ Open Questions" (`27424dba-446e-4204-ba0c-3f04c1950bad`): a "New after Sep 12" group appended at the end.
- "📚 Research & Docs": two sub-pages inserted after "Research: Cards, Loans & Accounts" (`79114796-a0a2-472f-828d-118a4ad8781d`), before the divider `a50d239f-4150-4c91-a907-b7fbddd060ce`.

To undo, remove the added blocks and restore the texts above.

## Research sub-pages

All blocks on these pages were written by Claude through the API from Cayden's account; the last edits are the bulk syncs at 2026-09-12 03:02 and 05:03 UTC, and no block was edited after that.

| Local file | Notion sub-page | Page id | Change |
| --- | --- | --- | --- |
| research/SUMMARY.md | ChatGPT Brief (Research Summary) | 8ea1ead8-f511-448b-88b6-73b96458d319 | Body re-rendered; the 133 old top-level blocks are archived (restorable from page history) |
| research/03 to 08 | Research: Stock Market, Impact, City Visuals, Debt & Credit, Debt System Design, Cards | see below | Only the blocks whose text changed are edited in place (texts before the edit are listed below), plus inserted new blocks |
| research/09-wellbeing-meter.md | Research: Wellbeing Meter (new) | 767d8146-802c-4890-9d40-351c00d86016 | Created |
| research/10-teleport-and-goal-skips.md | Research: Goal Fast-Forward and Skips (new) | 64762e3b-80ee-4725-8b84-c6cf65a69296 | Created, with a note that the age teleport was removed |

The research/08 mirror is a condensed page and has no teleport text, so it is left unchanged.
Differences between the research/05 and research/08 mirrors and their local files that predate this sync (for example the "12. Full-screen world and NPCs" section) are not part of this sync.

## Sub-page blocks edited in place (text before the edit)

| Sub-page | Block id | Text before the edit |
| --- | --- | --- |
| Research: Stock Market & Simulation | 79a2c9bc-3edb-4d66-a22c-e44f48600f75 | Update from the 2026-09-11 game design meeting (../meeting-2026-09-11-game-design.md): the player lives their own life (question 1), retirement is the end goal (question 7), and 1 tick is now 1 day, not 1 week. Normal speed is 1 in-game week every 10 real seconds, which replaces the speed table in Section 5; skips (next day/week/month/event, until a goal, teleport to an age) cover the long stretches. The weekly calibration above still holds; divide weekly drift by 5 and weekly volatility by sqrt(5) for trading days, and use dailyProb = 1 - (1 - annualProb) ** (1/365) for events. |
| Research: Impact, Learning & Judging | 263a501e-d274-4a72-ad66-a5f922971954 | C. Counterfactual "ghost" path. Because the sim is seeded and deterministic, re-run the same seed with the optimal policy (or "you, but you held during the crash") and plot both net worth lines on one chart. The dollar delta at retirement age ("that one panic sale cost future-you $41,000") is the single most memorable demo moment. This directly uses the rewind idea already in the README. |
| Research: City Visuals & Art Pipeline | 8cc6743f-6e77-4aff-80c5-7ea56ab2f95b | The sky runs its own clock: the meeting set normal speed to 1 game week per 10 real seconds (about 1.4 s per game day), which would strobe as a real day/night cycle, so the prototype gives the sky a cosmetic 72-second day; skips hold a steady daytime look. Seasons follow the calendar; weather is rolled per city per day from a climate table with the seeded RNG, and events such as Hurricane or Snow Storm force the matching weather. |
| Research: City Visuals & Art Pipeline | f49b41ce-1f52-473f-a649-8ab41b947d72 | The meeting chose a daily calendar (Stardew Valley style) at 1 game week per 10 real seconds, so a game day lasts about 1.4 s. A day/night cycle that fast would strobe, so the sky runs on its own cosmetic clock (72 real seconds per visual day, Clock.visualDaySeconds), while seasons and weather follow game days. |
| Research: City Visuals & Art Pipeline | ab67c0d6-d01f-487c-82b1-cfda5ce849a1 | Fast-forward and skips become a time-lapse: at "next week" or "next month" speed the sky stops crossfading every day and instead holds a blended daytime look, while the sun sweeps quickly and seasons change on the ground. During "skip to next event", the age teleport, and goal skips, the city visibly ages: seasons flash by, the player's home rebuilds tier by tier, cranes put up new towers in boom years, and the newspaper headlines scroll past, so skipping 36 years feels like watching a life happen. |
| Research: Debt & Credit | 946117ed-1396-49a1-a2d9-f19c0a0024de | Research on how debt works in the US in 2026 and how to build it into Larp City as a first-class system next to the stock market. Written 2026-09-11 during HackRice 2026. It follows the 2026-09-11 game design meeting (../meeting-2026-09-11-game-design.md): daily ticks, one player life, retirement as the goal, skips and the age teleport, and AI feedback only at goals, bankruptcy, and big swings. Where this doc conflicts with the meeting, the meeting wins. Mirrored to the team Notion page on 2026-09-11: a "💳 Debt & Credit" toggle section after Stock Market & Simulation, a "💳 Research: Debt & Credit" sub-page under Research & Docs, a "Debt & credit" group under Open Questions (each with a 💡 Suggested answer), and a debt section in the ChatGPT Brief. |
| Research: Debt & Credit | f93d5c50-c395-436f-967b-b71d95449b6c | Skips, the age teleport, and goals (sub_sub_header) |
| Research: Debt & Credit | 4bd61b48-6b2d-4650-8ea5-f61d20b86a10 | This answers part of the meeting's open question on events during skips. |
| Research: Debt & Credit | 50cae1cb-de08-4130-9717-f29ff34d9e58 | Age teleport inputs add a debt strategy: minimums only, avalanche, or snowball, plus an extra monthly amount. During the teleport, debt decisions auto-resolve by that strategy; D5 (payday) is auto-declined and D1 is auto-resolved down the waterfall. |
| Research: Debt & Credit | de5f11fc-fa83-4ef7-b7fd-505ed4783ec4 | Bankruptcy stops the teleport at the trigger in Section 4, and the recap shows the ladder step by step. |
| Research: Debt System Design | 00cbdf83-7dd1-45b5-848e-21af147523e7 | One pure TypeScript engine, tickDay(book, ctx), runs once per game day. The live calendar calls it at 1 in-game week per 10 s, and skips, the age teleport, and the ghost lines call the same function headless, so every number the player sees comes from one code path. |
| Research: Debt System Design | 3acdeee2-9f94-4c24-a03b-a21ee64e0613 | project(debts, strategy, extra) runs month by month with the real card minimum, and pays extra plus every freed-up payment to the target debt. It powers the payment slider's debt-free date, the ghost lines, and the age teleport's debt input. For the sample household ($44,500 across four debts, $300 extra): minimums take 22.3 years and $22,425 of interest; snowball and avalanche both take 4.0 years, at $7,280 and $7,188, and snowball clears its first debt at month 5 versus 21. |
| Research: Debt System Design | bfbac671-54af-4831-9568-f1dca3659c5c | Headless: player.runHeadless(fromDay, days, startDate) runs skips and the age teleport and stops at bankruptcy. |

A new paragraph ("Update from 2026-09-12 ...") is inserted after `79a2c9bc` on the Stock Market sub-page.

## Main page suggestion block (text before the edit)

| Section | Block id | Text before the edit |
| --- | --- | --- |
| ❓ Open Questions (💡 suggestion under "How should random timelines and events be implemented?") | b1416b76-a915-446f-a623-15a09daaadd8 | 💡 Suggested: Seeded daily roll per event: dailyProb = 1 - (1 - annualProb)^(1/365), times modifiers for season, city climate, and market regime (layoffs 3x in bear markets), with cooldowns and one-off flags (AI Bubble Pop). Market crashes come from the market director. Skips, the age teleport, and goal skips run the same rolls headless; decisions auto-resolve from the teleport inputs, and bankruptcy stops the skip (per the meeting). |

A sentence is appended: "(Sep 12: the age teleport was removed; this now applies to goal fast-forwards.)"
