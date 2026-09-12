# 12 - Simplifying the Credit Desk UI

Research on making the Credit Desk (`game/debt.html`) and the market views simpler to see, use, and understand.
The desk was rebuilt from this research as the Money desk on 2026-09-12; [game/README.md](../game/README.md) describes it as it is now.
Written 2026-09-12 during HackRice 2026.
The Card Shop (`game/src/debt-demo/shop.ts`) is the reference for what "good" looks like; the Desk view (`game/src/debt-demo/main.ts`) is what needs work.
Mockups: `.lavish/credit-desk-mockups.html` (three directions plus a recommended hybrid).

## TL;DR

- The Desk is a trading terminal: a ticker tape, six equal KPI tiles, one chart with four unrelated tabs, a 7-column table, a rates table, five FICO bars, a feed, and scenario buttons, all on one screen.
- The Card Shop works because each tile shows three numbers, one bar, and one button, and the art carries the feeling.
- Research on novices says: one headline number, one next action, one line per chart, plain words before jargon, and detail behind a tap.
- Recommended direction: a "Money" screen led by the debt-free date and a single "next move", debts as Card-Shop-style cards, one "your plan vs minimums" chart, and question-named tabs (Money, Credit score, Investing) for everything else.
- The ticker, rates table, FICO weights, and activity feed move behind "Details" or into History.

## 1. What is wrong with the current Desk

Observed in the browser on 2026-09-12 with the default save (Texas, $44,500 debt, score 665, Avalanche plus $300).

| Problem | Where | Why it hurts |
| --- | --- | --- |
| Scrolling ticker (Nasdaq, Dow, Fed funds, "+12 bp") | Top of every view | Constant motion, no decision attached, teaches watching the market instead of planning |
| Six KPI tiles of equal weight | Row 1 | Nothing tells the eye where to start; net worth, cash, debt, score, date, and DTI compete |
| One chart, four tabs (payoff, net worth, S&P 500, rates) | Main panel | Four unrelated questions share one frame; each chart should sit next to the decision it supports |
| Payoff axis runs to 2049 | Payoff tab | The chosen plan is squeezed into the first fifth of the chart |
| "m29 / m5 / m21" | Strategy panel | Unexplained code for "first payoff in month N" |
| 7-column liabilities table, "Balance-weighted APR", Visa minimum shown as "$0.00" | Liabilities | Dense and confusing; the $0.00 reads like a bug |
| Rates table (Fed funds, prime, 10-year Treasury) | Right column | Context for experts, not a decision for the player |
| FICO factor weights as percentages | Credit report | Accurate but not actionable; nothing says which factor to fix |
| Snowball swatch in the legend is nearly invisible | Chart legend | White on white |

## 2. Principles from the research

- **Progressive disclosure.**
  Show what matters most first and put advanced or rare detail behind a tap; it makes interfaces easier to learn and less error-prone ([NN/G](https://www.nngroup.com/articles/progressive-disclosure/)).
- **A dashboard is read at a glance.**
  Stephen Few defines it as the most important information for a goal, on one screen, readable at a glance: a few key facts, not everything we have ([Few, Perceptual Edge](https://www.perceptualedge.com/files/Dashboard_Design_Course.pdf)).
- **Beginners misread charts.**
  In one low-income sample, average graph literacy was 1.47 out of 4, and it was the only predictor of comprehension ([PLOS ONE](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0241844)).
  A y-axis that doesn't start at zero made 83.5% of viewers see bigger changes than were there, even after being warned ([ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S2211368120300978), [arXiv](https://arxiv.org/pdf/1907.02035)).
  Rule: one line per chart where possible, direct labels, a caption that says what happened, and money charts start at $0.
- **Plain words beat jargon.**
  In Federal Reserve testing, many consumers did not understand "default APR" but did understand "penalty APR", and people skipped anything outside the familiar summary box ([Federal Reserve Bulletin](https://www.federalreserve.gov/pubs/bulletin/2011/articles/designingdisclosures/default.htm)).
  Rule: say "costs 24% a year" and show "APR" in small print.
- **Never rely on red and green alone.**
  Pair color with an arrow or sign, and label lines directly ([Datawrapper](https://www.datawrapper.de/blog/colorblindness-part2), [data.europa.eu](https://data.europa.eu/apps/data-visualisation-guide/accessible-colour-palettes)).
- **Reward safe milestones, not trading.**
  Massachusetts cited Robinhood's confetti, popular-stock lists, push notifications, and scratch-off free stock; Robinhood removed the confetti in March 2021 and settled for $7.5M, and the SEC's 2021 request for comment covered streaks, badges, and celebrations ([MA complaint](https://www.sec.state.ma.us/divisions/securities/download/MSD-Robinhood-Financial-LLC-Complaint-E-2020-0047.pdf), [CNBC](https://www.cnbc.com/2021/03/31/robinhood-gets-rid-of-confetti-feature-amid-scrutiny-over-gamification.html), [SEC](https://www.sec.gov/newsroom/press-releases/2021-167)).
  Celebrating a paid-off debt, a new score band, or a full emergency fund is fine.

## 3. Patterns worth borrowing

| Product | Pattern | Use in Larp City |
| --- | --- | --- |
| Undebt.it | Headline is the debt-free date plus total interest; snowball/avalanche toggle updates it instantly ([undebt.it](https://undebt.it/)) | Hero card on the Money screen |
| Monarch | Curved payoff line per debt; "what if I pay extra" preview that doesn't commit ([Monarch help](https://help.monarch.com/hc/en-us/articles/44373293932052-Using-Pay-Down-Goals)) | Extra-payment slider previews the new date |
| Tally | Tells you which card to pay instead of showing a table ([CNBC Select](https://www.cnbc.com/select/tally-app-review/)) | "Your next move" card |
| Credit Karma | Score, then factor cards tagged High / Medium / Low impact with a plain target ("keep card use under 30%") ([Credit Karma](https://www.creditkarma.com/credit/i/what-affects-your-credit-scores)) | Credit tab: one "biggest lever" chip up front |
| Experian | Band name next to the number ([Experian](https://www.experian.com/blogs/ask-experian/infographic-what-are-the-different-scoring-ranges/)) | "665 Fair" (already done) |
| Betterment / Wealthfront | On-track verdict first, median line with a likely-range band, one action ("save $X a month") ([Betterment](https://www.betterment.com/legal/goal-projection), [Wealthfront](https://support.wealthfront.com/hc/en-us/articles/211003503-How-do-you-project-my-portfolio-s-returns-in-the-graph)) | Investing tab projection |
| Acorns | One deposit slider and a line of what it could grow to ([Acorns](https://www.acorns.com/invest/)) | "If you'd put $100 a month in..." |
| Robinhood (early) | One portfolio line; the screen accent shows up or down ([teardown](https://medium.com/@ericyi/ux-teardown-3-robinhood-79e310f7578), [Google Design](https://design.google/library/robinhood-investing-material)) | Investing tab chart, with arrows as well as color |
| Apple Stocks | Watchlist row: name, sparkline, price, tappable % pill ([iDownloadBlog](https://www.idownloadblog.com/2022/11/14/new-in-ios-16-2-apples-stocks-app-gains-watchlist-sorting-and-display-options/)) | The phone Stocks app already does this; keep it there |
| Cash App | Buy in dollars with preset amounts, not shares ([Cash App](https://cash.app/stocks)) | "Invest $100" buttons |
| Public.com | Short "why it moved" notes ([review](https://www.listenmoneymatters.com/public-review/)) | Annotated dips on the market chart |
| YNAB | One number with a clear target ([YNAB](https://support.ynab.com/en_us/assigning-your-money-a-guide-SypgkrNJi)) | Supports the single-hero approach |
| BitLife / NGPF Payback | A few 0-100% meters that move after each choice ([BitLife wiki](https://bitlife-life-simulator.fandom.com/wiki/Stats), [NGPF](https://www.ngpf.org/blog/paying-for-college/ngpf-launches-payback/)) | Fits with the wellbeing meter (research 09) |

Caveats: the Robinhood color details come from design teardowns, not Robinhood itself.
The BitLife and Payback patterns are from descriptions, not from playing.
No source was found for a specific "5 to 7 KPIs" limit, so this note does not claim one.

## 4. The three mockups

All three use the game's tokens from `debt.css` and the default save.

1. **A. Money home.**
   A debt-free-date hero with a progress bar and three insets (cash, owed, score); a yellow "Your next move" card; debts as four Card-Shop-style tiles with a plain rate pill and a "gone by" date; one "your plan vs minimums" chart; a bottom tab bar.
   Cheapest to build; still a dashboard.
2. **B. Debt quest.**
   Debts are levels on a map in the order the strategy attacks them, each with an HP bar equal to its balance; big strategy choice cards with interest cost and "first win in N months"; a score inset with the payoff that fixes it.
   Most game-like and best for the demo, but the most new UI.
3. **C. Three questions.**
   Tabs named "What do I owe?", "How's my credit?", "Is my money growing?".
   The market tab shows one index, a ▲ 12% headline, an annotated dip with the lesson, your own investment balance, a "what if" line, and a "pay the 24% card before investing" card; tickers and rates sit in a collapsed "Details".
   Each tab stays as simple as the Card Shop, but no single overview.

## RECOMMENDED DESIGN

- Use A as the frame and swap its bottom bar for C's question tabs: Money (A), Credit score, Investing (C's market tab), Card Shop.
- Order the debt tiles in the strategy's attack order and mark the current target, borrowing B's level idea without the HP framing unless the team wants it.
- Lead with the debt-free date, not net worth.
  The research suggests a net-worth hero, but the default save starts at −$40,800, which is demoralizing and not actionable; switch the hero to net worth once it turns positive.
- Replace jargon: "costs 24% a year (APR)", "first debt gone in 5 months" instead of "m5", "card use 78%, aim under 30%" instead of a utilization bar, and hide DTI and bp.
- Every chart of the player's own money starts at $0 and has one highlighted line plus a caption; the payoff chart's x-axis ends shortly after the chosen plan finishes, with minimums shown as a labeled ghost that runs off the edge.
- Move the ticker, rates table, rate-shock button, FICO weights, and activity feed into "Details" and History; layoff and moving become city events rather than buttons.
- Celebrate milestones (a debt paid off, a score band crossed), never trades.

## Open questions

1. Is B's boss framing on-tone for a game about real debt, or too cute?
2. Should the Investing tab trade inside the Desk, or only link to the phone's Stocks app?
3. Does the Desk keep its own speed controls, or inherit the city's clock now that it opens over the city?
