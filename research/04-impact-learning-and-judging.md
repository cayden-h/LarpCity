# 04 - Impact, Learning Science, Competition, and Judging

Research for Larp City, HackRice 16 (Sep 11-13, 2026), Finance track.
Compiled 2026-09-11.
Academic citations use numbered references [n] listed at the bottom; web sources are linked inline.

## TL;DR

- Classic financial education barely moves behavior and decays within about 20 months [1], but education delivered at a "teachable moment", tied to a specific decision, works much better [1][2].
  Larp City should be built as a machine for teachable moments, not a textbook with sprites.
- Simulations beat lectures on engagement and short-term learning [24][16], and the design details that matter are strategic mechanics plus explicit reflection prompts [13].
- Seeing a realistic rendering of your future self increases saving [18][19][20].
  The Persona-verified look-alike avatar is not just a gimmick; it is the strongest evidence-backed hook in the whole concept, if we age it and keep the tone hopeful [22].
- The problem is getting worse: US financial literacy just hit a 10-year low (47% correct, Gen Z 38%) per the [2026 TIAA-GFLEC P-Fin Index](https://www.tiaa.org/public/institute/publication/2026/tiaa-gflec-personal-finance-index), and 37% of adults still cannot cover a $400 emergency with cash ([Fed SHED 2026](https://www.federalreserve.gov/publications/2026-economic-well-being-of-us-households-in-2025-accessible-version.htm)).
- Realistic prize stack: Finance track + Capital One (Nessie) + Persona + ElevenLabs (sponsor) + MLH ElevenLabs + MLH Gemini API + MLH Tiger Data + MLH Vultr + MLH Backboard + GoDaddy Registry, all from one submission.
  Only one track is allowed, so Finance vs. Games & Gamification is the one real choice.

## 1. Does game-based or simulation-based financial education change behavior?

### The sobering baseline

Fernandes, Lynch and Netemeyer's meta-analysis of 201 studies found financial education interventions explain only 0.1% of the variance in financial behavior, with weaker effects in low-income samples [1].
Effects decay: even large interventions with many hours of instruction have negligible effects on behavior 20 months or more later [1].
Their recommendation is a "real but narrower role for just-in-time financial education tied to specific behaviors" [1].
A matched-sample study of high school personal finance courses found students who took the course were no more literate and did not behave better 1 to 4 years later [9].
A 2025 review of global experiments confirms short-term gains are common but fade without ongoing reinforcement, and that digital delivery and monetary incentives alone do not fix this [10].

### The more optimistic update

Kaiser and Menkhoff's meta-analysis of 126 impact evaluations finds financial education does significantly affect behavior, and literacy even more, but effects are weaker for low-income clients, debt behavior is the hardest to change, and success depends on intensity and delivering education at a "teachable moment" [2].
A later meta-analysis of 76 randomized experiments (over 160,000 people) finds positive causal effects on both knowledge and downstream behavior, similar in size to education interventions in other domains [3].
In schools specifically, the average effect is +0.25 SD on knowledge but only +0.05 SD on behavior [4].
Interventions help with saving and record keeping but not with credit default [5].
Life-cycle modeling shows one-time programs produce short-term but few long-term effects, while programs with follow-up to sustain knowledge can raise retirement savings by close to 10% [6].
Financial education appears to matter most for long-horizon behaviors (retirement saving) where real-life feedback arrives too late for learning by doing to work [7].
That last point is the core argument for a simulation: it compresses decades of delayed feedback into minutes.

### Evidence that works in the field

The US Army's personal finance course reduced credit balances and delinquencies in the first year (fading in year two) and raised retirement savings rates with effects persisting at least two years, especially when paired with enrollment assistance [8].
A large Peruvian school experiment produced immediate literacy gains and, three years later, a 20% reduction in arrears among students with loans [25].
Short stories about risk diversification improved knowledge in both the short and longer term, while compound interest and inflation gains decayed over eight months [11].

### Games and simulations specifically

Financial simulation games produced higher learning effectiveness and motivation than multimedia web materials in a 16-week quasi-experiment with 168 college students [24].
A 2x2 study of 293 students playing the game Moonshot found that the combination of strategic game mechanics and direct reflection prompts was what raised perceived utility value [13].
In the 2026 study of "Unforeseen: The decision game", financial knowledge only weakly predicted in-game decision quality, suggesting games measure something beyond quiz knowledge, and that human players clearly beat random play [14].
A narrative serious game study found immersion helps goal setting and decisions, but emotional tension and fatigue can hurt comprehension [15].
A systematic review finds simulation games improve analytical and reflective decision skills and can reduce biases such as overconfidence and the disposition effect [16].
Trading simulations paired with self-diagnosis make biases like loss aversion and overconfidence visible to students [17].
Reviews of youth programs name experiential learning as the most promising method, and for college students recommend focusing on specific life events [12].
Branching roleplay simulations with downstream consequences and an assess, practice, assess loop produced measurable transfer in corporate training [23].

### Future-self research (directly relevant to the selfie avatar)

People who interacted with age-progressed renderings of themselves chose later monetary rewards over immediate ones more often [18].
In a field test with nearly 50,000 Mexican retirement savers, an aging filter raised one-time contributions by 16% (1.5% to 1.7%) at a return of nearly 500 times its cost [19].
Community college students shown age-progressed avatars scored higher and more confidently on a financial literacy test and wanted more long-term planning workshops [20].
A field experiment with 415 investment clients found a digitally aged photo raised saving intentions, with only a short-term, modest effect on dollars invested [21].
Important caveat: when the aged image triggered negative emotions, people felt less connected to their future self and planned less six months later [22].
Design takeaway: show an aged avatar that is recognizably the player, living a life shaped by their choices, and frame the good path as attainable rather than showing a miserable old person as a scare tactic.

### Design principles derived from the evidence

1. **Just-in-time decisions.** Teach a concept only at the moment the player must act on it (the crash modal teaches sequence risk and staying invested, the medical bill modal teaches emergency funds) [1][2].
2. **Compress delayed feedback.** Make long-horizon consequences (compounding, retirement, debt interest) visible within minutes, because real life delivers that feedback too late [7].
3. **Consequence plus reflection.** After each big event, show a one-screen "what happened and why" with a counterfactual line, not only a score [13][23].
4. **Future-self connection.** Age the Persona-verified avatar and show the retirement-age version of "you" on each path, kept hopeful rather than horrifying [18][19][22].
5. **Personalization.** Use the player's real state, rent, salary band and goals so the scenario feels like their life; relevance drives utility value [13][12].
6. **Replay and spaced practice.** Rewind to a decision and replay, and bring the same decision type back in later years, since single exposures decay [6][10].
7. **Target the hard behaviors.** Weight scenarios toward debt handling, emergency saving and panic selling, where education alone underperforms [2][5].
8. **Bridge to a real action.** End with one concrete real-world next step (open a high-yield savings account, set a 401k match percentage), mirroring the Army's enrollment assistance effect [8].
9. **Balance emotion.** Tension is useful, but too much fear and fatigue harms learning; keep sessions short and recoverable [15][22].

## 2. The problem: current US numbers for the pitch

| Stat | Number | Source |
| --- | --- | --- |
| Average financial literacy score | 47% of 28 questions correct, lowest in 10 years | [TIAA-GFLEC P-Fin Index 2026](https://www.tiaa.org/public/institute/publication/2026/tiaa-gflec-personal-finance-index) |
| Gen Z financial literacy | 38% correct | [P-Fin 2026 report](https://gflec.org/wp-content/uploads/2026/06/TIAA_GFLEC_Report_AnnualPFin_June2026_fin2.pdf) |
| Risk comprehension | Only 36% of risk questions correct, low across all generations | [P-Fin 2026](https://www.tiaa.org/public/institute/publication/2026/tiaa-gflec-personal-finance-index) |
| Very low literacy share | Grew from 20% (2017) to 25% (2026) | [P-Fin 2026](https://www.tiaa.org/public/institute/publication/2026/tiaa-gflec-personal-finance-index) |
| $400 emergency | 63% would cover it with cash or equivalent, so 37% could not | [Fed SHED 2026 (2025 data)](https://www.federalreserve.gov/publications/2026-economic-well-being-of-us-households-in-2025-accessible-version.htm) |
| Unexpected expenses | 59% had at least one major unexpected expense last year; car (30%), home (22%), medical (21%) | [Fed SHED 2026, Economic Hardships](https://www.federalreserve.gov/publications/2026-economic-well-being-of-us-households-in-2025-economic-hardships.htm) |
| Young adults missing bills | 24% of 18-29 year olds did not pay all bills, vs. 9% of 60+ | [Fed SHED 2026, Economic Hardships](https://www.federalreserve.gov/publications/2026-economic-well-being-of-us-households-in-2025-economic-hardships.htm) |
| Retirement on track | Only 35% of non-retirees think so; 22% of 18-29 year olds | [Fed SHED 2026, Savings and Investments](https://www.federalreserve.gov/publications/2026-economic-well-being-of-us-households-in-2025-savings-investments.htm) |
| Retirement account ownership | 61% of non-retirees; only 38% of 18-29 year olds | [Fed SHED 2026, Savings and Investments](https://www.federalreserve.gov/publications/2026-economic-well-being-of-us-households-in-2025-savings-investments.htm) |
| Investing confidence | 47% comfortable managing investments (55% men, 39% women) | [Fed SHED 2026, Savings and Investments](https://www.federalreserve.gov/publications/2026-economic-well-being-of-us-households-in-2025-savings-investments.htm) |
| 3-month emergency fund | 46% have one, down from 53% in 2021 | [FINRA Foundation NFCS 2024](https://www.finra.org/media-center/newsreleases/2025/finra-foundation-releases-sixth-wave-national-financial-capability) |
| Paying cards in full | 53% always do, down 6 points since 2021 | [FINRA Foundation NFCS 2024](https://www.finra.org/media-center/newsreleases/2025/finra-foundation-releases-sixth-wave-national-financial-capability) |
| Credit card debt | $1.26 trillion (Q2 2026), near the $1.28T record | [NY Fed via CNBC, Aug 2026](https://www.cnbc.com/2026/08/11/ny-fed-credit-card-debt-hits-1point26-trillion-k-shaped-divide-persists.html), [NY Fed release](https://www.newyorkfed.org/newsevents/news/research/2026/20260811) |
| Total household debt | $18.8 trillion | [NY Fed, Q2 2026](https://www.newyorkfed.org/newsevents/news/research/2026/20260811) |
| Cost of bad timing | Fund investors earned 7.0%/yr vs. 8.2% for the funds (1.2%/yr gap, 2015-2024) | [Morningstar Mind the Gap 2025](https://www.morningstar.com/business/insights/research/mind-the-gap) |
| Gen Z starts early | 82% of Gen Z investors started before 21; top holdings crypto (55%) and single stocks (41%) | [FINRA Foundation-CFA Institute](https://www.finra.org/media-center/newsreleases/2023/finra-foundation-cfa-institute-research-focuses-gen-z-investors) |
| FOMO and finfluencers | 41% of Gen Z investors cite FOMO; 61% of under-35 investors act on finfluencer tips | [CFA Institute Gen Z report](https://rpc.cfainstitute.org/sites/default/files/-/media/documents/article/industry-research/Gen_Z_and_Investing.pdf), [CFA Finfluencer report](https://rpc.cfainstitute.org/sites/default/files/-/media/documents/article/industry-research/finfluencer-report.pdf) |
| Schools catching up | 30 states require a standalone personal finance course (39 counting embedded) | [NGPF](https://www.ngpf.org/blog/advocacy/how-many-states-require-students-to-take-a-personal-finance-course-for-high-school-graduation/), [CEE 2026 via Yahoo Finance](https://finance.yahoo.com/news/council-economic-education-reports-more-130000252.html) |

Caveat on the Morningstar gap: a 2026 Financial Analysts Journal paper argues the methodology overstates the timing penalty ([Fulkerson et al.](https://rpc.cfainstitute.org/research/financial-analysts-journal/2026/bad-timing-does-not-cost-investors-funds-returns)).
Say "Morningstar estimates" rather than presenting it as settled fact.

Pitch line suggestion: "Financial literacy just hit a 10-year low, 1 in 3 Americans can't cover a $400 surprise, and the classes we've built for it fade within two years.
Larp City teaches at the one moment research says actually works: the moment you have to decide."

## 3. Competitive landscape

| Product | What it is | Strength | Gap vs. Larp City |
| --- | --- | --- | --- |
| [BitLife](https://en.wikipedia.org/wiki/BitLife) | Text life sim with random events | Huge engagement, "one more life" loop | Money is shallow and unrealistic; no real costs of living, investing model or learning feedback |
| [Spent](https://playspent.org/) (McKinney, for Urban Ministries of Durham) | Month of low-income survival choices | Powerful empathy, widely used in classrooms | One month, one scenario; no investing, no long horizon, no personalization |
| [NGPF Arcade](https://www.ngpf.org/arcade/) (Payback, Build Your STAX, Shady Sam, etc.) | Free single-topic mini-games | Curriculum-aligned, teacher-trusted | Each game is one concept in isolation; no persistent life where choices compound |
| [SIFMA Stock Market Game](https://www.stockmarketgame.org/) | Classroom portfolio competition, 700,000+ students/yr | Scale, real market data | Investing only; rewards short-term winners, which can teach the wrong lesson |
| [Financial Football](https://www.financialfootball.com/en) (Visa + NFL) | Trivia inside a football game | Brand reach, used in 45 states | Quiz with a skin; tests knowledge, not decisions |
| [Budget Hero](https://www.marketplace.org/budget-hero) (Marketplace) | Federal budget balancing | Clever systems framing | Civic budget, not personal finance |
| [Zogo](https://zogo.com/) | Bite-sized lessons with rewards, 1M+ users via banks and credit unions | Distribution through financial institutions | Duolingo-style lessons; no simulation of consequences |
| [Greenlight](https://greenlight.com/) | Kids' debit card with parental controls and learning | Real money, real behavior | Paid product for families with kids; teaches spending habits, not life-scale tradeoffs |
| Robinhood-style paper trading | Practice trading | Realistic markets | Encourages trading, which is the behavior that creates the return gap |

The gap Larp City fills: no existing product combines (a) a persistent life where rent, debt, emergencies and investing interact over decades, (b) the player's own face and real state cost of living, (c) event-driven, just-in-time decisions with counterfactual feedback, and (d) a real-life plan at the end.
Most tools are either quizzes (knowledge, which decays) or single-topic sims; Larp City teaches judgment across the whole system.
The team's LEGO City reference also gives it a playful, visual, city-builder feel that none of the classroom tools have.

## 4. Measuring impact in the demo

Judges on the "Practicality & Impact" axis respond to evidence, even tiny evidence.
Build these in-game rather than claiming impact in a slide.

**A. Pre and post micro-quiz (60 seconds each).**
Use the P-Fin 8, a concise validated 8-question financial literacy measure ([TIAA-GFLEC P-Fin 8 quiz](https://www.tiaa.org/content/dam/tiaa/institute/pdf/2026-05/tiaa-institute-gflec-p-fin-8-quiz.pdf)), or 3 to 5 questions mapped to the events the player will face (emergency fund, compound interest, diversification, sequence risk, credit card APR).
Show "You got 2/5 before and 4/5 after" on the end screen.
The benchmark comparison is a strong hook: "Americans average 47%; you just scored 80%."

**B. Decision Quality Score (DQS), per decision.**
For each event, score the choice against a rules-based policy (emergency fund first, never sell at the bottom if the horizon is long, pay highest APR first, capture the full 401k match).
Report the score as a percent and explain it in one line, e.g. "Selling in the crash locked in a 32% loss; holding recovered in 14 months."

**C. Counterfactual "ghost" path.**
Because the sim is seeded and deterministic, re-run the same seed with the optimal policy (or "you, but you held during the crash") and plot both net worth lines on one chart.
The dollar delta at retirement age ("that one panic sale cost future-you $41,000") is the single most memorable demo moment.
This directly uses the rewind idea already in the README.

**D. Behavior-aligned metrics, not just points.**
Track emergency fund months, debt-to-income, savings rate, retirement on-track flag and "panic sells" count, the same concepts the Fed and FINRA measure, so in-game outcomes map onto real-world outcomes.

**E. Real-life takeaway screen ("Your Real Plan").**
Generated from the player's actual state and in-game choices:
- Emergency fund target in dollars for their state's cost of living (for example 3 months of rent plus essentials).
- The one habit they got wrong most often, with the one action that fixes it this week.
- A 401k/IRA contribution percentage that would have put them on track in the sim.
- Links to free, non-commercial resources ([Consumer Financial Protection Bureau](https://www.consumerfinance.gov/), [Investor.gov compound interest calculator](https://www.investor.gov/financial-tools-calculators/calculators/compound-interest-calculator)).
- An LLM (Gemini for the MLH prize) can write this in plain language from the event log, with the numbers computed deterministically by the sim, not by the model.

**F. Hackathon-scale evidence.**
Have 5 to 10 hackers play for 3 minutes on Saturday night, record pre/post scores and DQS, and report "n=8, average score went from X to Y" in the video and live demo.
Be honest that it is a tiny sample; judges reward honesty and a clear evaluation plan.

## 5. HackRice 16 judging, tracks, prizes and deadlines

Sources: the [HackRice 16 hacker handbook](https://docs.google.com/document/d/1lqTThw7-FnLS0I7OSM_q0o2_Ls0L5AAMccHT4Ibrwkw/) (public text export) and the [HackRice 16 Devpost](https://hackrice-16.devpost.com/).
The handbook says sponsor details are still being finalized, so re-check both on Saturday.

### Deadlines and format

- **Devpost submission deadline: Sunday 9/13, 9:00 AM CT.** A 3-4 minute video is mandatory.
- Recommended video outline: 30s intro (name, members, track/challenges, purpose, tech), 2 min demo, 30s technical design, 30s impact and future work.
- **Choose at most 1 track, but as many challenges as you like.**
- **Live judging Sunday 9:30 AM to 12 PM**: present 3-4 times, each 3 minutes total (2 min demo, 1 min Q&A).
- Eligibility: teams of 2-4, college students, 18+, US residents.

### Judging criteria (handbook)

1. **Technical Rigor** - technically advanced solutions using APIs, or an extensive solution integrating simple technologies.
2. **Originality & Creativity** - new angles, using an API in a unique way.
3. **User Experience & Design** - aesthetically pleasing, clear and intuitive.
4. **Practicality & Impact** - solves a real problem; scope and scalability matter.
5. **Relevance** - fit with the chosen track or challenge.

### Tracks relevant to Larp City

- **Finance Track (prize: espresso machine).**
  "Personal wealth management solutions ... help people understand their finances and make better decisions."
  Judges want projects that "don't just display numbers; they turn raw financial data into personalized, actionable insight" and build "healthier financial habits over time."
  Example directions include goal-based planning for an emergency fund, paying down debt and saving.
  Past winners (OwlNudge, Swipe Coach) are practical tools, so Larp City must visibly end in a real, personalized plan to feel on-brief.
- **Games & Gamification Track (prize: professional poker set, plus a surprise for theme-related submissions).**
  Explicitly lists "Gamified learning that turns a subject or skill into a game loop" and wants "something genuinely fun ... people actually want to come back to."
  Larp City arguably fits this track more naturally, with less direct competition from budgeting apps.
  The team chose Finance; that is defensible because Finance judges will value the real-plan ending, but it is the one decision worth a 2-minute team check before submitting.

### Sponsor challenges and prizes

| Challenge | Prize | What it asks for |
| --- | --- | --- |
| Overall | 1st Ruko drone, 2nd Kodak PixPro camera, 3rd Whoop | Best overall |
| Capital One | $250 Giftogram gift card per member | Handbook: "Best Use of Nessie", creatively integrating Nessie endpoints (accounts, merchants, bills, P2P) to improve users' financial lives. Devpost lists it as "Best Financial Hack" for anything finance-related. |
| Persona "Prove you're human" | Surprise award | "Build something where access depends on a verified human, and make it feel good." Sandbox, web widget, pass/fail toggle, workshop Saturday 2:15 PM. |
| ElevenLabs (sponsor) | 3 months Scale tier per member ($897 value each) | Best project built with ElevenLabs |
| MLH Best Use of ElevenLabs | Wireless earbuds | Separate MLH prize, same integration counts |
| MLH Best Use of Gemini API | Google swag kits | Use Gemini (workshop: Intro to Google AI Studio, Saturday 3:30 PM) |
| Goldman Sachs | TBD | "Challenge details to come" - watch Discord |
| Lilie Lab AI Challenge | $50 Amazon + Launchpad acceptance | **Rice students only**, any AI use |
| Notability | Surprise | Use Notability Pro for ideation; tag it and add 2+ screenshots |
| MLH Best Use of Tiger Data | Stream Deck Mini | High-performance apps on Tiger Data's Postgres (TimescaleDB): real-time data, time-series metrics, analytics, lag-free live charts |
| MLH Best Use of Vultr | Portable screens | Deploy on Vultr cloud infrastructure, including GPUs for AI ($100 MLH credits) |
| MLH Best Use of Backboard | Tile Essentials Pack | AI apps with persistent state across sessions: long-term memory, RAG, embeddings, tool calls, model routing |
| MLH Best Domain Name (GoDaddy Registry) | Digital gift card | Register a domain with GoDaddy Registry |
| Other MLH (Solana, Presage) | Various | Low fit for Larp City |

There are no dedicated education, design or social good prizes listed; those qualities score through "Practicality & Impact" and "User Experience & Design" instead.

## 6. Prize-stacking table

| Prize | Fit | What Larp City must show | Effort |
| --- | --- | --- | --- |
| Finance track | High | End-of-game personalized plan with real dollar numbers from the player's state; emergency fund, debt and retirement goals | Core |
| Capital One Nessie | High | NPC and player accounts, bills, and transactions actually created and read through Nessie (not a one-call token integration); show Nessie data on screen, e.g. the bank dashboard | Medium |
| Persona | High if framed well | A verified human unlocks something meaningful: your verified selfie becomes your look-alike avatar, verified players get a one-person-one-account leaderboard (no bot farming the city), and age-aware mode (adjusted content for younger users). Demo both the pass and fail paths with the sandbox toggle | Medium |
| ElevenLabs sponsor + MLH ElevenLabs | High | Voice onboarding interview (the mayor or advisor NPC) plus voiced event alerts during crashes; show it live, not only in the video | Medium |
| MLH Gemini API | Medium-high | Gemini writes the "what went wrong" post-mortem and the "Your Real Plan" narrative from the event log | Low |
| Overall | Stretch | Polish, a memorable demo moment (the ghost-path chart), clear impact numbers | - |
| MLH Tiger Data | High | Weekly NPC finances, market prices, events, and current city data stored as time-series, powering live net-worth charts, the leaderboard, and rewind | Medium |
| MLH Vultr | Medium | The game and backend hosted at a public URL judges can open, with API keys server-side | Low |
| MLH Backboard | Medium-high | The advisor and narrator remember each player's past decisions across sessions and answer from our research docs (RAG), with model routing | Medium |
| MLH GoDaddy Registry | Low | A domain pointing at the Vultr server | Low |
| Lilie Lab | Only if a teammate is a Rice student | Any AI use | Low |

Realistic stack: Finance + Capital One + Persona + ElevenLabs + MLH ElevenLabs + MLH Gemini + MLH Tiger Data + MLH Vultr + MLH Backboard + GoDaddy Registry, from a single submission.
Updated 2026-09-11 after reviewing the [MLH HackRice prizes page](https://www.mlh.com/events/hackrice-71/prizes): Tiger Data, Vultr, and Backboard each have a real role in the game, so they moved from low fit to the stack.
Every integration should serve the learning loop, because judges reward "using an API in a unique way," not bolted-on checkboxes.

## 7. Accessibility and responsible design

**No personalized investment advice.**
Show a persistent footer and end-screen note: "Larp City is an educational simulation, not financial, tax, or investment advice. Results are hypothetical."
Teach principles (diversify, hold through volatility with a long horizon, emergency fund before investing, match before extra) rather than naming securities to buy.
Use fictional tickers or broad index categories in the stock sim so it cannot be read as a stock pick.
Keep the LLM on a short leash: it explains what happened in the sim and recommends generic, widely accepted behaviors; prompt it to refuse specific security recommendations and to defer to a fiduciary or free nonprofit counseling for real situations.
Note that 20% of adults would take financial advice from AI ([FINRA NFCS 2024](https://www.finra.org/media-center/newsreleases/2025/finra-foundation-releases-sixth-wave-national-financial-capability)), which makes guardrails a genuine responsibility.

**Realistic, not doom-inducing.**
Research shows negative emotion toward the future self reduces planning [22] and too much tension harms comprehension [15].
Every bad outcome should come with a recovery path and a "try again from here" button.
Frame bankruptcy as a lesson screen, not a game-over punishment.
Show the aged avatar living well on the good path, rather than only a sad version on the bad path.
Pair crashes with historical recovery context so the lesson is "stay calm" rather than "markets are scary."

**Inclusive to low-income users.**
Financial education works less well for low-income people [1][2], often because advice assumes slack that does not exist.
Offer starting profiles across incomes, including minimum wage, gig work, and student with loans, not just a $90k tech job.
Make "good" decisions feasible at every income: at low income the win might be avoiding a payday loan, building a $500 buffer, or getting an EITC refund, not maxing a Roth IRA.
Don't moralize spending; model real tradeoffs (childcare, car repairs, food costs) the way Spent does.
Use real cost-of-living differences between states so players see that geography matters, not just willpower.

**Privacy and Persona.**
Only use the Persona sandbox during the hackathon; never store real IDs.
Explain in one sentence why verification exists (your avatar is really you, and the leaderboard has no bots).
Let players delete the selfie-derived avatar and play without the real-bank or voice features.

**Accessibility basics.**
Captions for every ElevenLabs voice line, keyboard-operable decision modals, color-blind-safe gain/loss colors (don't rely on red vs. green alone), plain-language copy at about an 8th-grade reading level, and pause-anytime time controls.

## 8. Pitch framing (one paragraph)

Americans just posted their worst financial literacy score in a decade, one in three can't cover a $400 surprise, and the classes we've built to fix it fade within two years because they teach money before people ever have to use it.
Larp City flips that: you verify you're human with Persona, your selfie becomes your citizen, and you live a compressed financial life in a real US city with real costs, where layoffs, medical bills and market crashes interrupt the clock and ask you to decide right then, the "teachable moment" research says actually changes behavior.
Every choice ripples forward, a ghost line shows what the other path would have earned, you meet the older version of yourself your decisions created, and you leave with a real plan built for your state and your paycheck.
We don't tell you what to buy; we let you feel what panic-selling, skipping an emergency fund, or capturing a 401k match does to your life, before it costs you anything real.

## 9. Design principles checklist

1. Teach only at the moment of decision (just-in-time), never as an upfront lecture.
2. Every major event: decision, consequence, one-line explanation, counterfactual.
3. Compress long-horizon feedback (compounding, retirement, APR) into visible minutes.
4. Make the player's future self visible and relatable, hopeful not horrifying.
5. Personalize with real state costs of living and the player's own income band.
6. Allow rewind and replay, and repeat decision types across years (spaced practice).
7. Prioritize the hardest real-world behaviors: debt, emergency savings, panic selling.
8. Score decision quality, not just net worth, so luck doesn't masquerade as skill.
9. End with one concrete real-world action plus a personalized plan.
10. Measure learning in-game (pre/post quiz, DQS, ghost path) and show the numbers.
11. Education, not advice: disclaimers, fictional tickers, guarded LLM.
12. Winnable at every income level; no moralizing.
13. Short sessions, pause anytime, captions, color-blind-safe, plain language.

## References (academic, via Consensus)

[1] [Financial Literacy, Financial Education, and Downstream Financial Behaviors](https://consensus.app/papers/details/a03543f582ee538ebb31c7e81c6bc4c4/?utm_source=claude_desktop) (Daniel Fernandes et al., 2014, Manag. Sci., 1919 citations)
[2] [Does Financial Education Impact Financial Literacy and Financial Behavior, and If So, When?](https://consensus.app/papers/details/5054db0d49775809be72a8dc56f0cd42/?utm_source=claude_desktop) (Tim Kaiser et al., 2017, 471 citations)
[3] [Financial Education Affects Financial Knowledge and Downstream Behaviors](https://consensus.app/papers/details/851a2993a8f65e109bb6b7e6ce49461c/?utm_source=claude_desktop) (T. Kaiser et al., 2020, SSRN Electronic Journal, 512 citations)
[4] [Financial education in schools: A meta-analysis of experimental studies](https://consensus.app/papers/details/9ee4f6271f7051b98affbae4aa409e0c/?utm_source=claude_desktop) (T. Kaiser et al., 2020, Economics of Education Review, 219 citations)
[5] [Can You Help Someone Become Financially Capable?: A Meta-Analysis of the Literature](https://consensus.app/papers/details/a5e60433ed8959e8803ecd7449b2c3e2/?utm_source=claude_desktop) (Margaret J. Miller et al., 2015, World Bank Research Observer, 319 citations)
[6] [Assessing the impact of financial education programs: A quantitative model](https://consensus.app/papers/details/8feba67fb54c5e9fa213feddb0dc9be1/?utm_source=claude_desktop) (A. Lusardi et al., 2020, Economics of Education Review, 57 citations)
[7] [The Effects of Financial Education on Short-Term and Long-Term Financial Behaviors](https://consensus.app/papers/details/8eb4ab1b1e95519c9d610c235ce11a3c/?utm_source=claude_desktop) (Jamie Wagner et al., 2018, Journal of Consumer Affairs, 130 citations)
[8] [Assessing Financial Education: Evidence from Boot Camp](https://consensus.app/papers/details/b9e63f64e2eb5e018e1ba158b37d2795/?utm_source=claude_desktop) (William L. Skimmyhorn, 2016, American Economic Journal: Economic Policy, 73 citations)
[9] [The Impact of Financial Literacy Education on Subsequent Financial Behavior](https://consensus.app/papers/details/4d3802b11ce55b369793a3e855826db3/?utm_source=claude_desktop) (Lewis Mandell et al., 2009, Journal of Financial Counseling and Planning, 724 citations)
[10] [What works in financial education? Experimental evidence on program impact](https://consensus.app/papers/details/82f58f84dad25476b6c6b25f1c6c4071/?utm_source=claude_desktop) (G. García et al., 2025, Journal of Behavioral and Experimental Economics, 8 citations)
[11] [Evaluating the effects of a low-cost, online financial education program](https://consensus.app/papers/details/2b43eb03ee79587ab081863bac6a19d1/?utm_source=claude_desktop) (Robert L. Clark et al., 2025, Journal of Economic Behavior & Organization, 9 citations)
[12] [A review of financial-literacy education programs for children and adolescents](https://consensus.app/papers/details/467b8fcfbc245e1fb291576ca5ca6a29/?utm_source=claude_desktop) (Aisa Amagir et al., 2018, Citizenship, Social and Economics Education, 299 citations)
[13] [Financial Literacy Games - Increasing Utility Value by Instructional Design in Upper Secondary Education](https://consensus.app/papers/details/cd08c8b3f17c5a13931b24dcf1e14c34/?utm_source=claude_desktop) (Liane Platz et al., 2025, Education Sciences, 13 citations)
[14] [The relationship between financial literacy, self-efficacy, and performance in a financial simulation game.](https://consensus.app/papers/details/b1b6e18b05c35888a8ea171ba51a0129/?utm_source=claude_desktop) (Cindy Chamberland et al., 2026, Acta psychologica, 0 citations)
[15] [Promoting Financial Literacy Among Young Adults: A Narrative-Driven Serious Game Approach](https://consensus.app/papers/details/8643878a1947578b977a89e229d6ec96/?utm_source=claude_desktop) (Sheng-Ming Wang et al., 2025, IEEE GEM, 1 citation)
[16] [Role of Game-Based Learning in Improving Financial Literacy and Investment Skills Among the Young Generation](https://consensus.app/papers/details/d3a649c8a27d5f8ebf4dac3df95ed358/?utm_source=claude_desktop) (Wahid Hasyim Kosasih et al., 2025, Jurnal Pendidikan Ekonomi Undiksha, 4 citations)
[17] [Teaching trading psychology and behavioural biases through simulation-based experiential learning in accounting and finance education](https://consensus.app/papers/details/4e912bcad06e5f9cb37eb2903eb5162f/?utm_source=claude_desktop) (Donald Amuah et al., 2026, Accounting Education, 0 citations)
[18] [Increasing Saving Behavior Through Age-Progressed Renderings of the Future Self](https://consensus.app/papers/details/754d45aeeca85d53abd9f882872fb901/?utm_source=claude_desktop) (Hal E. Hershfield et al., 2011, Journal of Marketing Research, 625 citations)
[19] [Saving for retirement: A real-world test of whether seeing photos of one's future self encourages contributions](https://consensus.app/papers/details/65ed7efc729b557a9dc6d8c1568f5f73/?utm_source=claude_desktop) (J. D. Robalino et al., 2023, Behavioral Science & Policy, 11 citations)
[20] [The Future Is Now: Age-Progressed Images Motivate Community College Students to Prepare for Their Financial Futures](https://consensus.app/papers/details/a5f87750ac225409b9be865ca6251449/?utm_source=claude_desktop) (Tamara L. Sims et al., 2020, Journal of Experimental Psychology: Applied, 27 citations)
[21] [Does enhancing the vividness in connection with the future self increase savings behavior? A field experiment](https://consensus.app/papers/details/5f266c583d715d3aab196d9e51debb31/?utm_source=claude_desktop) (Edgar E. Kausel et al., 2024, Journal of Behavioral and Experimental Economics, 7 citations)
[22] [Emotional reactions to the aged future self matter: A 6-month longitudinal study on retirement planning](https://consensus.app/papers/details/07d38240cbeb56d08f65ade22b68d2cf/?utm_source=claude_desktop) (D. Yeung et al., 2025, Innovation in Aging, 0 citations)
[23] [Experiential Learning at Scale with Computer-Based Roleplay Simulations](https://consensus.app/papers/details/eae69b41a02357a5b56e08cebb5b89c2/?utm_source=claude_desktop) (Bethany E. Kok et al., 2018, Int. J. Adv. Corp. Learn., 3 citations)
[24] [Enhancing Finance Students' Learning Effectiveness and Motivation: Application of Financial Simulation Game](https://consensus.app/papers/details/e547173c081d5a6d98579bfb407c9f80/?utm_source=claude_desktop) (Jui-Sheng Wang, 2023, Int. J. Emerg. Technol. Learn., 3 citations)
[25] [Is School-Based Financial Education Effective? Immediate and Long-Lasting Impacts on High School Students](https://consensus.app/papers/details/df5bb28206ac5b1cb63beda04d7cd7be/?utm_source=claude_desktop) (Verónica Frisancho, 2022, The Economic Journal, 41 citations)

Upgrade to Consensus Pro to return 20 results per search instead of 10, and include more data like study design and key takeaways for every result.: https://consensus.app/pricing/?utm_source=claude_desktop
