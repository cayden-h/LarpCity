# Larp City - Revamp Meeting (2026-09-13)

Decisions from the team's revamp meeting on Sunday of HackRice.
Sources: the team's meeting summary and the Granola notes for the meeting (https://notes.granola.ai/t/f40c66ec-d236-4083-a263-8243c7f0e1ce).
Where these decisions conflict with [meeting-2026-09-11-game-design.md](meeting-2026-09-11-game-design.md) or the research docs, this file wins.

## Decisions

### Avatar and player setup

- The avatar is a male or female preset, with no customization.
  This replaces the Persona selfie avatar.
- Every player starts at age 22, just out of college, which explains the starting debt.
- Starting salary is randomized between $35,000 and $50,000; San Francisco's cost of living pushes it toward about $60,000.
- Starting debt is randomized between $20,000 and $40,000.
- Every player starts with a 600 credit score.
- A preset, fake Plaid connection at the start frames the finances as already known.
  The narrator presents the salary, age, and financial snapshot, and the player sets goals and preferences from there.

### Narrator onboarding

- The narrator is named Sammy and walks the player through setup.
- Health insurance plan selection (changeable later).
- Credit card selection from 3 real beginner cards (for example Discover it and a Capital One student card).
- An emergency fund target of 6 months.
- Roth IRA and 401(k) contributions from $0 to $7,500 by slider or text input; the company matches 2%.
- Expense ranges for food, house bills, fitness, gas, and car maintenance, each low, medium, or high.
- A car loan of $500 a month over 6 years, and car insurance of $200 a month.
- Every value stays changeable throughout the game.

### Goals

- Goals are set once at the beginning and are permanent, but trackable in the Goals app.
- Long-term goals only: the age of retirement, marriage, paying off debt by a certain age, and buying a house.
- The Goals app shows a progress bar for how on track the player is.
- Happiness is a soft goal on top: vacations and family time raise it; injuries that cost money, major financial events, and falling stocks lower it.

### Events

- Events are randomly generated from a formula; the stock market is the main demo event.
- Stock market events: crashes, booms, recessions, penny stocks, and the AI bubble pop (the most important).
- Divorce, with a prenup option at the wedding: signed keeps the money, unsigned loses half.
- Injuries and hospital stays: a car crash raises insurance costs, and without health insurance the player pays out of pocket.
- Car breakdowns grow more likely as time goes on; the player chooses to pay for the fix or buy a new car.
- Natural disasters were removed as too complex.
- Taxes: a tutorial once in year 1, then skipped automatically if the player did it correctly.

### UI and phone apps

- Keep every existing app except Weather, which is removed.
- The News app shows stock market updates only.
- The Mail app shows billing only.
- The avatar in the bottom left reflects the happiness meter with 3 static facial expressions.
- A small player ID card (name, age, avatar) replaces the home upgrade button.
- The state map stays, with no travel between states; a vacation is a static pop-up (a plane flying by).
- Going back in time is removed until the end-of-game review.
- The "Skip to next interactive event" button stays.
- Three save slots, with load files, so judges can jump to pre-built game states in the demo.

### End goal

- The game ends at retirement: the progress bar fills and a Retire button unlocks.
- Passing means retiring before age 65; the score reflects financial decisions and happiness.
- Finishing the game signals financial literacy to the bank, which could qualify the player for real cards.

### Extras (after the core)

- Job progression through "LARPedIn": the player applies to jobs, gets rejected, and climbs restaurant ranks.
- Phone notifications to drive engagement.

## Who builds what

The work was split into three plans, built at the same time and merged in order.

- **P1, avatar, player setup, and Sammy's onboarding** (a teammate): the starting age, salary, debt, and credit score, the fake Plaid screen, and the onboarding screens for insurance, cards, the emergency fund, retirement contributions, expenses, and the car. Merges first.
- **P2, goals, happiness, and the phone** (a teammate): the Goals page and its 4 goal types, the happiness meter and avatar faces, the player ID card, trimming the phone apps, the vacation pop-up, and the Retire button with the end screen. Merges second.
- **P3, life events, taxes, save slots, and going back** (Cayden): the seeded event engine (divorce and the prenup, injuries, car breakdowns, recessions, penny stocks), the year-1 tax tutorial, three save slots with the judges' demo lives, and going back only in the end-of-game review. Merges last.

## Next steps

- Adjust the salary and debt defaults for San Francisco's cost of living.
- Build the 3 save slot load files for the judges' demo.
- Build the insurance plan and credit card screens (frontend only for now).
- Work on the video deliverable.
