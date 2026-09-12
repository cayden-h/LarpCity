# Larp City - Setup, API Keys, and Integrations

Researched 2026-09-11 (HackRice 16, Sep 11-13) against each provider's live docs.
Items we could not confirm are marked **UNVERIFIED**; test them before building on them.
Deeper background for the avatar pipeline is in [research/01-avatar-and-persona.md](research/01-avatar-and-persona.md).

Every track below follows the same shape: account setup, keys, code, how it maps to the game, what to test first, what the judges want, and gotchas.

- [Persona](#persona-prove-youre-human)
- [Capital One Nessie](#capital-one-nessie-best-financial-hack)
- [ElevenLabs](#elevenlabs-best-project-built-with-elevenlabs--mlh-best-use-of-elevenlabs)
- [Gemini](#gemini-mlh-best-use-of-gemini-api)
- [Tiger Data](#tiger-data-mlh-best-use-of-tiger-data)
- [Backboard](#backboard-mlh-best-use-of-backboard)
- [Vultr](#vultr-mlh-best-use-of-vultr)
- [Domain](#domain-mlh-best-domain-name-from-godaddy-registry)

## TL;DR - what changes the plan

- **Persona Sandbox does not really verify anyone.**
  Docs: "Real verifications are not performed within sandbox mode."
  The Persona challenge is "Prove You're Human" ("access depends on a verified human"), so ask the Persona sponsor table on Saturday morning for a production environment or demo credits.
  Until then, sandbox plus the force-pass / force-fail toggle demos both branches.
- **The backend is `server/`.**
  Every key below is secret except Persona's template and environment ids, so an Express server holds the keys and the browser calls only our own `/api/*` routes (see [server/README.md](server/README.md)).
  Persona is optional there for now, so the server boots without it.
- **Nessie is a transaction log, not a ledger.**
  It never applies deposits or withdrawals to an account's `balance`, truncates cents, rejects negative balances, has no payee on transfers, and can't delete customers (probed 2026-09-12, see the Nessie section).
  The game stays the source of truth and mirrors each month into Nessie.
- **Gemini image generation has no free tier.**
  `gemini-3.1-flash-image` is paid only (about $0.067 per 1K image), so one person must turn on billing in AI Studio.
  Billing also means our prompts are not used for training, which we want for selfies anyway.
- **Gemini's terms require users to be 18+**, so the Persona 18+ gate must run before a selfie is sent to Gemini; Learning mode players get a pick-your-parts avatar instead.
- **Tiger Data has no permanent free plan.**
  It is a 30-day trial ($1000 credit, no card), which covers the hackathon.
- **Nessie data is world-readable.**
  `/enterprise/*` returns every team's customers and accounts, so never send real names or PII to Nessie.
- **Age estimation comes back as a pass or fail check, not an age number.**
  Read `selfie_age_comparison` inside the selfie verification's `checks`; a documented "estimated age" field was not found (UNVERIFIED).
- **Free credits are small.**
  ElevenLabs gives 10k credits a month and Backboard gives $5 for 30 days, so cache every generated line and use cheap models for frequent calls.

## Architecture

```
browser (Vite + PixiJS, game/)                     server (Node, server/)                 providers
--------------------------------                   ----------------------                 ---------
consent screen -> getUserMedia selfie (memory) --> POST /api/avatar ---------------------> Gemini image (rotating keys)
Persona Web SDK (templateId + environmentId) ----> POST /api/persona/complete ---------> Persona API: GET inquiry, then DELETE (redact)
                                          Persona --> POST /api/persona/webhook (HMAC check)
voice interview (client tool submit_finances) <-- GET /api/voice/signed-url -----------> ElevenLabs Agent
narrator lines, captions, sfx <------------------ POST /api/tts, /api/sfx (cached) ----> ElevenLabs TTS / Sound Effects
AI feedback, news digest <----------------------- POST /api/feedback, /api/news -------> Gemini text (JSON schema), Backboard memory + RAG
bank view <-------------------------------------- /api/bank/* (monthly sync) ----------> Capital One Nessie
charts, leaderboard, rewind <-------------------- /api/snapshot, /api/history/* -------> Tiger Data (Postgres + TimescaleDB)
```

Hosting: one Vultr VPS runs Caddy (HTTPS, serves `game/dist`, proxies `/api/*` to Node on port 3000), with the MLH domain pointing at it.

## Persona ("Prove You're Human")

Prize: surprise.
Criteria: "Build something where access depends on a verified human, and make it amazing!"

### 1. Account and template (about 30 min)

1. Sign up at https://app.withpersona.com/dashboard/register; a sandbox API key is issued right away and sandbox costs nothing.
2. Dashboard > Inquiries > Templates: create a template from a selfie preset, then open the Flow Editor.
3. Flow Editor > Verifications > Selfie Verification > Checks: turn on liveness and age estimation (18+) if the plan allows it.
   The help article says some settings are "not on every plan", so whether sandbox allows age estimation is UNVERIFIED.
4. **Publish** the template; only published versions can be embedded.
5. Template settings or the Domain Manager: allow `localhost` (sandbox only), our domain, and each subdomain separately.
6. Add a Workflow that approves the inquiry on `inquiry.completed` when the checks pass, so the backend acts on `approved` / `declined` only.
7. Dashboard > Webhooks: add `https://<our-domain>/api/persona/webhook` (use `cloudflared` or `ngrok` locally) for `inquiry.approved`, `inquiry.declined`, `inquiry.failed`, and `inquiry.expired`.

### 2. Keys and ids

| Item | Looks like | Where | Secret? | Env var |
| --- | --- | --- | --- | --- |
| API key | `persona_sandbox_...` | Dashboard > API > API Keys | Yes | `PERSONA_API_KEY` |
| Template id | `itmpl_...` | Inquiries > Templates | No | `VITE_PERSONA_TEMPLATE_ID` |
| Environment id | `env_...` | Organization > Information | No | `VITE_PERSONA_ENVIRONMENT_ID` |
| Webhook secret | `wbhsec_...` | Dashboard > Webhooks | Yes | `PERSONA_WEBHOOK_SECRET` |

`itmplv_` is a pinned template version and `tmpl_` is a legacy template; we use `itmpl_`.

### 3. Browser (Web SDK)

`npm i persona` (v5.8.0, ships types).
`environment: 'sandbox'` is deprecated; pass `environmentId`.

```ts
import Persona from 'persona';

const client = new Persona.Client({
  templateId: import.meta.env.VITE_PERSONA_TEMPLATE_ID,
  environmentId: import.meta.env.VITE_PERSONA_ENVIRONMENT_ID,
  referenceId: playerId, // one Persona account per player: "one avatar per human"
  onReady: () => client.open(),
  onComplete: ({ inquiryId }) => fetch('/api/persona/complete', { method: 'POST', body: JSON.stringify({ inquiryId }) }),
  onCancel: () => showSkipPath(),
  onError: (e) => showSkipPath(e),
});
```

- Never trust `status` from `onComplete`; it is only for UI.
- Stretch: create the inquiry on the server (`POST /inquiries`) and pass `inquiryId` + `sessionToken` instead of `templateId`, which stops duplicate inquiries per player.
- The iframe asks for the camera itself; if we ever send a `Permissions-Policy` header it must include `camera=("https://*.withpersona.com")`, and a CSP must allow `*.withpersona.com` in `frame-src` and `connect-src`.
- Desktop players can hand off to their phone by QR code (built into the flow).

### 4. Server

Base URL `https://api.withpersona.com/api/v1`, headers `Authorization: Bearer $PERSONA_API_KEY` and `Persona-Version: 2025-12-08`.

| Call | Use |
| --- | --- |
| `GET /inquiries/{id}?include=verifications` | Read `status` and the selfie verification's `checks` (liveness, `selfie_age_comparison`) |
| `GET /verification/selfies/{id}` | `center-photo-url` etc. (signed `files.withpersona.com` URLs, treat as secrets) |
| `DELETE /inquiries/{id}` | Redact: permanently deletes the PII; call it right after we read the result and show it in the demo |
| `POST /inquiries/{id}/perform-simulate-actions` | Sandbox only: `approve_inquiry`, `decline_inquiry`, `create_passed_verification` for scripted demos and tests |

Statuses: `created`, `pending`, `completed`, `failed`, `expired`, `needs_review`, `approved`, `declined` (the list may grow, so default to "not verified").
Game mapping: `approved` unlocks full mode; `declined` or age check failed unlocks Learning mode; anything else offers a retry or the skip path.

### 5. Webhook

- Header `Persona-Signature: t=<unix>,v1=<hex>` (two space-separated pairs while a secret rotates).
- Verify: HMAC-SHA256 of `` `${t}.${rawBody}` `` with `PERSONA_WEBHOOK_SECRET`, hex, compared with `crypto.timingSafeEqual`; this needs the raw body, so no JSON parser on that route.
- Respond within 5 s; Persona retries 7 times, and events can arrive twice or out of order, so make the handler idempotent (key on the event id).
- For the hackathon, `/api/persona/complete` polling `GET /inquiries/{id}` is enough; the webhook is the "server-side checks" point for the judges.

### 6. Test in hour 1

- [ ] Does sandbox return our real captured frame at `center-photo-url`, or sample data? (UNVERIFIED either way.)
      Until confirmed, capture our own selfie with `getUserMedia` for Gemini and use Persona only as the gate.
- [ ] Can the sandbox template turn on age estimation?
- [ ] Ask the Persona booth: production environment or credits, and what "Surprise!!" judging looks for.

### 7. What judges want

Access that truly depends on a verified adult human (full mode with credit, loans, and investing), server-side confirmation instead of the client callback, one avatar per human, and visible data deletion (the redact call on stage).

## Capital One Nessie ("Best Financial Hack")

Prize: $250 in Giftogram gift cards, one winner, for "tools that will help with anything related to finance".
Nessie is optional for this track, but real bank ledgers updating live make the finance story concrete.

### 1. Account setup (about 10 min)

1. Go to https://nessieisreal.com and click Login (GitHub OAuth).
2. Copy the API key from the site's `/profile` page.
3. Base URL `https://api.nessieisreal.com`; the key goes on every request as `?key=...`.
4. Current docs are at https://nessieisreal.com/docs (the old `api.nessieisreal.com/documentation` returned 403).
5. The official JS SDK source is useful as a route reference: https://github.com/nessieisreal/nessie-javascript-sdk.

### 2. Keys

| Env var | Value | Secret? |
| --- | --- | --- |
| `NESSIE_API_KEY` | key from the profile page | Yes (query strings get logged, so never in the browser) |
| `NESSIE_BASE_URL` | `https://api.nessieisreal.com` | No |
| `NESSIE_TAG` | `larpcity`, a prefix for nicknames and descriptions | No |

### 3. What the live API does (probed 2026-09-12)

Every row below was checked against `api.nessieisreal.com` with our key; the client in `server/src/adapters/nessie.ts` is built on these shapes.

| Call | Body (required fields) | What happens |
| --- | --- | --- |
| `GET /customers` | | Only this key's customers (the `/enterprise/*` and `GET /accounts` lists show every team's data) |
| `POST /customers` | `{first_name, last_name, address:{street_number, street_name, city, state, zip}}` | 201 `{code, message, objectCreated}`; ids are UUIDs |
| `DELETE /customers/{id}`, `DELETE /merchants/{id}` | | **403: customers and merchants can never be deleted**, so never create them casually |
| `POST /customers/{id}/accounts` | `{type: "Checking" \| "Savings" \| "Credit Card", nickname, rewards, balance}` | 201; `"Credit Card"` works; **cents are truncated** (1200.57 becomes 1200) and **a negative balance is rejected** |
| `PUT /accounts/{id}` | `{nickname}` (required) | 202, but only `nickname` changes: `balance` and `rewards` are silently ignored |
| `DELETE /accounts/{id}` | | 200; the account 404s afterwards, but its deposits stay readable |
| `POST /accounts/{id}/deposits`, `/withdrawals` | `{medium: "balance", transaction_date, status, amount, description}` (all required) | 201; any date works, past (2010) or future (2030); **amounts are truncated to whole dollars**; long descriptions are fine |
| `POST /accounts/{id}/transfers` | `{transaction_date, status, amount, description}` | 201, but **there is no payee**: `payee_id` and `medium` are rejected as extra fields, and the transfer shows only on the sending account |
| `POST /accounts/{id}/purchases` | `{merchant_id, medium, amount}` plus optional `purchase_date, status, description` | Needs a merchant (`POST /merchants` with `{name, category: string, address, geocode}`) |
| `POST /accounts/{id}/bills` | `{status: "recurring", payee, nickname, payment_date, recurring_date, payment_amount}` | 201, with `upcoming_payment_date` computed |
| `POST /accounts/{id}/loans` | `{type: "home" \| "auto" \| "small business", status, credit_score, monthly_payment, amount, description}` | 201 |
| `GET /accounts/{id}/{deposits\|withdrawals\|transfers\|bills}` | | A list, or **404 with a message when the list is empty** |

**Nessie never applies transactions to `balance`.**
After a $1,000 deposit, a $50 withdrawal, and two $100 transfers, the checking account still reported its opening $500 ten minutes later, and PUT can't set it.
So Nessie is a transaction log, not a ledger: the simulation stays the source of truth, and every balance we show is the opening balance plus the posted transactions.
There is no published rate limit and no bulk endpoint.

### 4. Server code

- `server/src/adapters/nessie.ts`: the typed client (one method per row above). It keeps the key out of every error, unwraps `objectCreated`, turns empty-list 404s into `[]`, and retries throttling and failed reads, but never a POST that may have landed.
- `server/src/mirror.ts` and `server/src/routes/nessie.ts`: the bank mirror behind `/api/bank/*` ([server/README.md](server/README.md) has the routes).
- `game/src/sim/mirror/`: turns each game month into statement entries and sends them; `game/src/sim/npcs/` and `game/src/data/npcs.ts`: the named NPCs.

### 5. How it maps to Larp City (option B, built 2026-09-12)

**Two-tier NPC roster (Sep 12, Task 10–15):**

- **Primary roster: 12 named NPCs.** The player plus 12 marked NPCs (Maya the nurse, Jordan the barista, Priya, Marcus, Sofia, Kenji, Amara, Diego, Oscar, Hannah, Tariq, and Grace) each have a real Nessie customer with Checking, Savings (savings plus the emergency fund), and Credit Card (what the cards owe, as a positive number) accounts.
  Each NPC is a full money life (paychecks, state rent, debts) on the same seeded market, and each tells one lesson.
  In the city, primary NPCs render with a visible gold-ring marker and clicking any of them shows their real bank statement with recent spending across categories like Dining out and Coffee (see `game/src/ui/npccard.ts` for the statement UI and `game/src/sim/npcs/habits.ts` for their spending habits).
  Nessie customers are created once and reused across sessions because they can't be deleted (capped at 12 by the shared sandbox limit); accounts are per session and run, deleted on a new run.
- **Background roster: ~38 fallback-only NPCs.** `BACKGROUND_NPC_COUNT` (38, in `game/src/data/background-npcs.ts`) procedurally generated background walkers appear in the city unmarked (no gold ring) but fully clickable, exactly like the primary tier, showing a real, distinct local-only statement with the same categories.
  These NPCs are explicitly permanent fallback-only because Nessie customers can't be deleted and the sandbox is shared across hackathon teams, so the team self-capped the live tier at 12 rather than permanently littering the shared resource.
  Background NPCs land in Tiger Data with `local_only=true` and `nessie_id=NULL`; they go through the same monthly MonthMirror/BankSync pipeline as primary NPCs (categorized deposits/withdrawals posted monthly), but are routed through `FailoverNessie` constructed with `{ localOnly: true }`, so statements insert locally and never attempt to reach live Nessie; this keeps the roster open-ended without burning the 12-customer cap or risking PII leakage to the shared sandbox.
  Generated once from fixed archetypes rather than hand-authored, so growing the roster in future playtests is a one-line count change.
- No real names or PII: NPC names are fictional and the player's customer is "Player".
- **Mirror monthly.**
  At each game month's end the game posts one entry per category (paycheck, rent, living costs, card payment, each loan payment, investing, interest) plus one "Transfers and other" entry per account for each primary NPC, sized so the balance Nessie implies equals the sim's to the dollar.
  The game date goes in `transaction_date`, and the entry's key goes in `description` so a retried batch never posts twice.
  Background NPCs' statements are local only and never posted to Nessie.
- Goal fast-forwards and months when the server was down go out as one summary batch (primary tier only).
- Verified end to end on 2026-09-12 (local TimescaleDB, live Nessie): after two game months, all 9 statements matched the game's balances exactly.
- Two-tier roster verified on 2026-09-12 (controller QA, real browser + real local Postgres): 50 residents total (12 marked/primary via `/api/bank`, 38 unmarked/background via `/api/bank-bg`); primary walkers render with a gold ring, background walkers don't; a background NPC (Wei Moore) fetched via `/api/bank-bg` shows a real, distinct statement; Postgres confirms background customers land with `local_only=true, nessie_id NULL`, primary customers show `local_only=false`.

### 6. Test first

- [x] `GET /customers` returns only our customers.
- [x] A deposit does **not** update `balance`, even ten minutes later, and PUT can't set it: compute balances ourselves.
- [x] Any `transaction_date` is accepted, past or future.
- [x] `type: "Credit Card"` works; negative balances are rejected and cents are truncated.
- [x] `DELETE /accounts/{id}` works; customers and merchants can't be deleted.
- Leftovers on the key for good: two probe customers (`LC-probe1`, `larpcity-check`), one probe merchant (`Larp Grocer`), the 8 NPC customers, and one player customer per browser session that has run the mirror.

### 7. What judges want

Financial literacy with real impact (the brief's pitch numbers), practical takeaways, and live Nessie ledgers updating as the player lives their life.
HackRice's general criteria also apply: relevance, originality, practicality and impact, UX, technical rigor.

## ElevenLabs ("Best Project Built with ElevenLabs" + MLH Best Use of ElevenLabs)

Prizes: 3 months of Scale tier for "impactful use" of ElevenLabs audio, and wireless earbuds from MLH for "natural, human-sounding audio... realistic, dynamic, and emotionally expressive voices".

### 1. Account and agent setup (about 45 min)

1. Sign up at elevenlabs.io; the free plan gives 10k credits a month with TTS and Sound Effects (non-commercial, credit ElevenLabs).
2. Developers > API Keys: create a key for the server.
3. Voices: the owl narrator is Daniel, a built-in British voice (`onwK4e9ZLuTAKqWW03F9`); pick a **news anchor** voice too and copy both ids.
   The free plan can only use built-in voices through the API; Voice Library voices and Voice Design need the Creator plan.
4. Agents > New agent > Blank (the live one is "Larp City Narrator"):
   - System prompt: the owl narrator, a dry, deadpan English storyteller who narrates the player in the third person, plus the job: ask, one question at a time, for job title, annual salary, monthly rent, total debt, and savings; confirm the numbers, then call `submit_finances` exactly once. It may use one delivery tag per turn from [sighs], [slow], [whispers], and [laughs].
   - First message: "This is the story of a new arrival in Larp City. Before they could have the keys, the Narrator needed a few details. So. What do you do for work?"
   - Voice: Daniel on `eleven_v3_conversational` (Expressive Mode), with those four suggested audio tags.
5. Agent > Tools > Add Tool, type **Client**: name `submit_finances`, parameters `job` (string), `salary`, `rent`, `debt`, `savings` (numbers), and turn on **Wait for response**.
   Names are case-sensitive and must match the browser code.
6. Optional backup: Analysis > Data collection with the same five fields; results arrive in the post-call webhook at `analysis.data_collection_results` (signed with an `elevenlabs-signature` header).
   To turn it on, add a post-call webhook in the agents settings with the URL `https://<host>/api/voice/webhook`, enable only transcription events (audio events are large and unused), and put the secret it shows in `ELEVENLABS_WEBHOOK_SECRET`.
   The server stores each call in `voice_interviews`; after hanging up, the browser posts its conversation id to `/api/voice/interview/claim` and polls until `ready` is true.
7. Turn on authentication for the agent so the browser needs a signed URL.

### 2. Keys

| Env var | Purpose |
| --- | --- |
| `ELEVENLABS_API_KEY` | all calls (server only) |
| `ELEVENLABS_AGENT_ID` | signed URL for the interview agent |
| `ELEVENLABS_VOICE_NARRATOR` | the owl narrator's voice for `/api/voice/tts`, read on `eleven_v3` |
| `ELEVENLABS_VOICE_ANCHOR` | the news anchor's voice, read on `eleven_flash_v2_5` |
| `ELEVENLABS_WEBHOOK_SECRET` | verifies the post-call webhook; without it `/api/voice/webhook` answers 503 |

Packages: `@elevenlabs/elevenlabs-js` (server) and `@elevenlabs/client` (browser).

### 3. Server code

```ts
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
const el = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });

app.get('/api/voice/signed-url', async (_req, res) => {
  const r: any = await el.conversationalAi.conversations.getSignedUrl({ agentId: process.env.ELEVENLABS_AGENT_ID! });
  res.json({ signedUrl: r.signedUrl ?? r.signed_url }); // field casing UNVERIFIED, log which one comes back
});

// Narrator line with captions, cached on disk by hash(voice|model|text) so repeats cost no credits.
// The owl reads on 'eleven_v3', which performs tags like [sighs]; the server leaves tags out of the captions.
const out = await el.textToSpeech.convertWithTimestamps(voiceId, { text, modelId: 'eleven_v3' });
// Live alerts: el.textToSpeech.stream(voiceId, { text, modelId: 'eleven_flash_v2_5' }) piped to the response as audio/mpeg.
// Sound effects: el.textToSoundEffects.convert({ text: 'cash register ding', durationSeconds: 2, promptInfluence: 0.5 }).
```

### 4. Browser code

```ts
import { Conversation } from '@elevenlabs/client';

await navigator.mediaDevices.getUserMedia({ audio: true }); // after explaining why, on a user click
const { signedUrl } = await (await fetch('/api/voice/signed-url')).json();
const convo = await Conversation.startSession({
  signedUrl,
  clientTools: {
    submit_finances: async ({ job, salary, rent, debt, savings }) => {
      game.initPlayer({ job, salary, rent, debt, savings });
      return 'Saved. Tell the player their city is ready.';
    },
  },
  onMessage: (m) => ui.subtitle(m),
  onError: console.error,
});
```

Captions: group the alignment's character start times into words and show each word when `audio.currentTime` passes its start.

### 5. How it maps to Larp City

| Feature | ElevenLabs piece |
| --- | --- |
| Onboarding interview (real finances) | Agent + `submit_finances` client tool, with data collection as a backup |
| The owl narrator's big moments: arrival, a debt paid off, a missed payment, collections, bankruptcy (respectful), a move, a crash | TTS with timestamps on `eleven_v3`; the lines and their timing rules are in `game/src/narration/lines.ts` |
| Market crash and news alerts | Streaming TTS with `eleven_flash_v2_5` (low latency), anchor voice |
| Newspaper digest read aloud | TTS of the Gemini-written digest |
| Cash register, siren, crowd gasp | Sound effects, generated once and cached |
| Captions | alignment from the timestamps endpoint |

### 6. Test first

- [ ] `curl localhost:3000/api/voice/signed-url` returns a `wss://` URL (it must be used within 15 minutes).
- [ ] Speak the interview end to end; `submit_finances` fires once with numbers, not strings.
- [ ] The same TTS call twice: the second is a cache hit.
- [ ] Captions line up with the audio within about 100 ms.
- [ ] Pre-generate all fixed lines and SFX before judging.

### 7. What judges want

Voice that carries emotion at the moments that matter (crash, bankruptcy, the first paycheck), and a real conversation instead of a form.
The voice interview plus expressive `eleven_v3` hero lines is the pitch.

### 8. Gotchas

- Flash costs half as much as v3 ($0.05 vs $0.10 per 1k characters), so use Flash for bulk lines and v3 only for hero moments.
- `eleven_v3` allows 5,000 characters per request; Flash allows 40,000.
- Browsers block autoplay, so start audio after a click.
- Ask the sponsor table for a promo code (none found online).

## Gemini (MLH Best Use of Gemini API)

Prize: Google swag kits, "push the boundaries of what's possible with AI using Google Gemini".

### 1. Account setup (about 15 min)

1. aistudio.google.com > Get API key, in a new project.
2. **Turn on billing** at https://aistudio.google.com/projects to reach Tier 1; image models have no free tier (`gemini-3.1-flash-image` about $0.067 per 1K image, `gemini-3.1-flash-lite-image` about $0.034).
3. Check limits at https://aistudio.google.com/rate-limit (per project; Tier 1 also caps spend at $10 per rolling 10 minutes and returns 429 past it).
4. `npm i @google/genai@^2.3.0` (the Interactions API needs 2.3.0 or later).

### 2. Keys

| Env var | Value |
| --- | --- |
| `GEMINI_API_KEYS` | Comma-separated AI Studio keys; the server moves to the next key on 429 (quota) |
| `GEMINI_TEXT_MODEL` | `gemini-3.8-flash` (newest) |
| `GEMINI_FALLBACK_MODELS` | `gemini-3.6-flash` by default: tried in order when the text model is busy |
| `GEMINI_IMAGE_MODEL` | `gemini-3.1-flash-image` |

### 3. What the live API does (probed 2026-09-12)

- `generateContent` with `generationConfig: { responseMimeType: "application/json", responseJsonSchema }` returns the JSON as the text part, on both `gemini-3.8-flash` and `gemini-3.6-flash` (`responseSchema` works too).
- The key goes in the `x-goog-api-key` header; the `?key=` query string also works, but it ends up in URLs and logs.
- Gemini 3.x models think before answering: skip the parts marked `thought`, and give `maxOutputTokens` room (the thinking counts against it, so 300 cut answers off with `MAX_TOKENS`).
- **`gemini-3.8-flash` is often busy**: 503 "This model is currently experiencing high demand", sometimes a hang past 30 seconds, and now and then an instant empty-body 404 from Google's front end (listing models and `countTokens` still work at the same moment). All three mean "try another model".
- `gemini-2.5-flash` is closed to new users (404 "no longer available to new users"); Google points to `gemini-3.6-flash`.
- A 429 names the exceeded quota; the keys may share one project's quota, so rotating helps only when they don't.
- `gemini-3.6-flash` answered the coach and newspaper prompts in about 4 to 14 seconds.
- The newer Interactions API (`POST /v1beta/interactions`) also works; its answer comes back under `steps`, not `output_text`. The server doesn't use it.

### 4. Server code

- `server/src/adapters/gemini.ts`: the `Gemini` client. It sends the key in the header, falls back through the models (15 seconds each), rotates keys on 429, skips thought parts, and parses the JSON answer.
- `server/src/ai/facts.ts`: the fact sheets (from the run's snapshots and events in Tiger Data, in whole dollars) and the plain-text fallbacks built from them.
- `server/src/ai/coach.ts`: the prompts, the JSON schemas, and the checks on every answer; a bad answer, an error, or no model falls back to the plain text.
- `server/src/routes/ai.ts`: `POST /api/feedback`, `/api/news`, and `/api/avatar` (routes table in [server/README.md](server/README.md)).

### 5. How it maps to Larp City

| Feature | Gemini piece | Status |
| --- | --- | --- |
| AI feedback at goals, bankruptcy, and big swings (the meeting's three moments) | `POST /api/feedback` with `{ runId, trigger, day, goal? }`: the server reads the last 100 days of snapshots and 180 days of events and returns `{ headline, tip, mood }` | Built Sep 12; spoken by ElevenLabs later |
| Newspaper digest after a skip | `POST /api/news` with `{ runId, from, to }`: 1 to 4 stories `{ title, where, blurb, impact }` about the notable events, never routine paychecks and bills | Built Sep 12 |
| Avatar from the verified selfie | `POST /api/avatar`: image model, selfie + style reference, sliced into 8 directions in Pixi; answers 403 until Persona has verified an adult (Gemini's terms) | Route ready, waits on Persona and billing |
| Aged "future you" (Hershfield effect) | image edit of the player's sprite, "same character 30 years older, same style", hopeful on the good path | Not built |
| "Your Real Plan" at the end | text model, personalized to the player's state and choices | Not built |

The prompts carry only the fact sheet, never text the browser sends, and tell the model to use only those numbers; the same moment asked twice is cached, and the AI routes share the strict rate limit (20 a minute).

### 6. Test first

- [x] A text call works, with a JSON schema (`gemini-3.6-flash` and `gemini-3.8-flash`).
- [x] End to end on a local TimescaleDB with a real 400-day run: all three triggers and the newspaper came back from Gemini with correct whole-dollar numbers, a repeat was served from the cache in 10 ms, and the plain-text fallback covers a busy or missing model.
- [ ] Billing on: one image from one input image.
- [ ] Two reference images: likeness and style both hold.
- [ ] The sheet slices cleanly in Pixi after the magenta chroma key.

### 6. What judges want

Multimodal use (image in, image out) plus structured output that drives game logic, not just a chat box.

### 7. Gotchas

- The Gemini API terms require users to be 18+ and ban services likely to be used by minors, so only verified adults send a selfie, and we never accept photos of children.
- Use only the player's own face (consent screen), and drop the selfie right after generation.
- Every image carries a SynthID watermark (a good responsible-AI talking point).
- Image generation is slow (thinking is on by default), so show a "building your citizen..." animation.

## Tiger Data (MLH Best Use of Tiger Data)

Prize: Stream Deck Mini, for "the most innovative, impactful, and performance-driven use of Tiger Data" (real-time data, time-series metrics, analytics; MLH names financial prediction engines as an example).

### 1. Account setup (about 20 min)

1. Start the trial at https://www.tigerdata.com/go/trial (30 days, $1000 credit, no card).
2. Create a Time-series + Postgres service in a region near the Vultr box (for example AWS us-east-1 for a New Jersey or Atlanta VPS).
3. Copy the connection string and download the password (it may be shown only once).
4. The connection pooler (pgBouncer) is optional; one Node process with a `pg.Pool` is fine.
5. Optional CLI: `curl -fsSL https://cli.tigerdata.com | sh`, then `tiger auth login`.

### 2. Keys

`DATABASE_URL=postgres://tsdbadmin:PASSWORD@HOST:PORT/tsdb?sslmode=require` (server only).

### 3. Schema

The canonical schema is [game/db/schema.sql](game/db/schema.sql); the snippet below is the core subset.
It adds the real card catalog (`card_products`, `card_offers`), real FRED rates (`macro_rates`), and run hypertables for debt, applications, transfers, and rewards ([research/08-cards-loans-accounts.md](research/08-cards-loans-accounts.md), section 8).
Apply it and load the reference data in one step (tested locally against the `timescale/timescaledb:latest-pg17` Docker image):

```sh
pip install "psycopg[binary]" openpyxl
python3 research/data/cards/build_cards.py
DATABASE_URL=postgres://tsdbadmin:PASSWORD@HOST:PORT/tsdb?sslmode=require python3 game/db/load.py
```

Continuous aggregates need a real timestamp, so sim day N is stored as `'2000-01-01'::timestamptz + N * interval '1 day'`.

```sql
CREATE TABLE players (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE NOT NULL, created_at timestamptz DEFAULT now());
CREATE TABLE runs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), player_id uuid REFERENCES players, seed bigint NOT NULL,
  nessie jsonb, started_at timestamptz DEFAULT now(), ended_at timestamptz);
CREATE TABLE player_snapshots (ts timestamptz NOT NULL, run_id uuid NOT NULL, day int NOT NULL,
  net_worth numeric, checking numeric, savings numeric, brokerage numeric, retirement numeric, debt numeric)
  WITH (tsdb.hypertable, tsdb.partition_column='ts', tsdb.segmentby='run_id', tsdb.chunk_interval='1 year');
CREATE UNIQUE INDEX ON player_snapshots (run_id, ts);
CREATE TABLE market_prices (ts timestamptz NOT NULL, run_id uuid NOT NULL, symbol text NOT NULL, price numeric)
  WITH (tsdb.hypertable, tsdb.partition_column='ts', tsdb.segmentby='run_id,symbol', tsdb.chunk_interval='1 year');
CREATE TABLE events (ts timestamptz NOT NULL, run_id uuid NOT NULL, kind text, payload jsonb)
  WITH (tsdb.hypertable, tsdb.partition_column='ts', tsdb.chunk_interval='1 year');

```

The server adds what the run routes need at boot (`server/src/migrations.sql`, run one statement at a time because TimescaleDB won't create a continuous aggregate inside a transaction):

- `events.key` plus a unique index on `(run_id, ts, key)`, so a retried batch never inserts an event twice.
- Two real-time continuous aggregates over `player_snapshots`, `player_snapshots_weekly` (7-day buckets) and `player_snapshots_monthly`, each with `first_day`, `last_day`, and the bucket's last `net_worth`, `peak`, `low`, and account balances.
  `materialized_only = false` makes the newest days show before the one-minute refresh policy materializes them, so no refresh call is needed after a fast-forward.
  Week buckets start on Mondays and sim day 0 is a Saturday, so weeks run days 2-8, 9-15, and so on.

### 4. Server code

- `server/src/store/runs.ts` holds every query: runs, snapshot upserts (one row per day, latest wins), event inserts, history by day/week/month, events by day and kind, and the leaderboard.
- `server/src/routes/snapshot.ts` validates and calls it: `POST /api/runs`, `/api/snapshot`, `/api/events`, `GET /api/history/:runId?bucket=day|week|month`, `/api/events/:runId`, `/api/leaderboard` (routes table in [server/README.md](server/README.md)).
- The leaderboard shows every run while Persona is off and only verified players once `PERSONA_API_KEY` is set.

### 5. How it maps to Larp City (built 2026-09-12)

- `game/src/sim/record/` records the player's run from the first day: one snapshot per game day (net worth split into checking, savings, brokerage, retirement, and debt) and every life event, keyed `day:sequence`.
  It sends about once a game month, a whole goal fast-forward right after it finishes (in 5,000-row chunks), and keeps everything buffered while the server is down.
- Net-worth charts read the weekly and monthly aggregates (a 40-year run is about 2,100 weekly rows instead of 14,600 daily ones); the calendar and newspaper read events by day range and kind.
- Still to come: the rewind branches (a new run per changed decision with the old path as a ghost line), `market_prices`, and `debt_daily`.

### 6. Test first

- [x] TimescaleDB 2.30.0 on the live service; the schema's hypertables, the reference data, and Tri's `players` columns are there.
- [x] `cd server && TEST_DATABASE_URL=... npm test` runs the store against a throwaway database with the real schema and migrations: upserts, event keys, weekly and monthly buckets matching the raw days, and the leaderboard.
- [x] End to end with the game (local TimescaleDB): the recorded days match the game's own net-worth history.

### 7. What judges want

Continuous aggregates powering lag-free live charts, relational and time-series data in one database, and numbers (an `EXPLAIN ANALYZE` timing, hypertable stats) on a slide.
Stretch: a zero-copy fork (`tiger service fork <id> --name what-if`) as the "what if you had held" timeline (free on the trial is UNVERIFIED).

### 8. Gotchas

- `pg` returns `numeric` as a string; parse it or use `double precision`.
- Refresh policies lag, so refresh the aggregate after a headless skip.
- The trial ends after 30 days, so the database may pause after judging.

## Backboard (MLH Best Use of Backboard)

Prize: Tile Essentials Pack, for long-term memory, RAG, embeddings, and model routing ("persistent context that stays alive across every page refresh, session, and user").

### 1. Account setup (about 15 min)

1. Sign up at https://app.backboard.io.
2. Settings > API Keys: create a key (shown only once).
3. New accounts get $5 of credit for 30 days, no card.
4. `npm i backboard-sdk` (v1.5.16, Node only because it reads files from disk).
5. REST base `https://app.backboard.io/api` with header `X-API-Key`.

### 2. Keys

| Env var | Value |
| --- | --- |
| `BACKBOARD_API_KEY` | dashboard key |
| `BACKBOARD_COACH_ASSISTANT_ID` | the shared coach assistant that holds our research docs |
| `BACKBOARD_SMALL_MODEL`, `BACKBOARD_LARGE_MODEL` | `provider/model` strings picked from `GET /models` |

### 3. Server code

```ts
import { BackboardClient } from 'backboard-sdk';
const bb = new BackboardClient({ apiKey: process.env.BACKBOARD_API_KEY! });

// Once: the coach assistant with our research as RAG documents.
const coach = await bb.createAssistant({ name: 'Larp City Coach',
  system_prompt: 'You are a financial coach in a life sim. Ground advice in the uploaded research and 2026 rules. Be concise and kind.' });
for (const f of ['research/03-stock-market-and-simulation.md', 'research/06-debt-and-credit.md', 'research/02-states-cost-of-living.md']) {
  const d = await bb.uploadDocumentToAssistant(coach.assistantId, f);
  while ((await bb.getDocumentStatus(d.documentId)).status !== 'indexed') await new Promise(r => setTimeout(r, 2000));
}

// Per player: memory is scoped to the assistant, so clone the coach (documents come along).
const mine = await bb.cloneAssistant(process.env.BACKBOARD_COACH_ASSISTANT_ID!, { name: `player-${playerId}`, copy_documents: true });

// Model routing is per message.
const [p, m] = (deep ? process.env.BACKBOARD_LARGE_MODEL! : process.env.BACKBOARD_SMALL_MODEL!).split('/');
const r: any = await bb.sendMessage({ assistantId, threadId, content, memory: 'Auto', stream: false, llm_provider: p, model_name: m });
```

Other calls: `createThread(assistantId)`, `getMemories(aid, { page, pageSize })`, `searchMemories(aid, query, limit)`, `listModels()`.

### 4. How it maps to Larp City

- **Decision memory:** after each big decision, send a short fact ("Year 2031: sold everything in the Rate Shock at -22%") with `memory: 'Auto'`; next session the coach remembers it.
- **RAG coach:** answers "why?" questions from our research docs and the 2026 rules.
- **Model routing:** the small model for tooltips and quick quips, the large model for the bankruptcy post-mortem and the retirement review.
- A "Coach remembers" panel shows `getMemories`.
- Split with Gemini: Gemini writes structured feedback and images; Backboard supplies memory and grounding (or runs the coach text itself, if we want one voice).

### 5. Test first

- [ ] `curl -H "X-API-Key: $BACKBOARD_API_KEY" https://app.backboard.io/api/billing/balance` shows about $5.
- [ ] `listModels` confirms our two model strings.
- [ ] Upload one `.md` and see it reach `indexed`.
- [ ] Send a fact in thread A; ask about it in thread B; it is recalled.
- [ ] A cloned assistant carries the documents (UNVERIFIED).

### 6. What judges want

Quit the game, reload, and have the coach cite a decision from the last session plus a research doc.

### 7. Gotchas

- `memory: 'Auto'` writes cost credits; use `'Readonly'` for frequent calls.
- One shared assistant would mix players' memories.
- Memory extraction is async, so a recall test right after a write can miss.
- `sendMessage` without an assistant or thread id silently creates a new default assistant.

## Vultr (MLH Best Use of Vultr)

Prize: portable screens, for "high-performance projects leveraging one-click deployment and scalable cloud compute".

### 1. Account setup (about 30 min)

1. Sign up at mlh.link/vultr-signup and verify your email.
2. Sign back in via mlh.link/vultr-giftcode and enter the gift code from the MLH coach ($100, no card, one account per person).
3. Deploy Cloud Compute (shared CPU), Ubuntu 24.04, 1 vCPU / 2 GB, in a region near the Tiger Data service, with your SSH key.

### 2. Server setup

```bash
adduser larp && usermod -aG sudo larp && rsync --archive --chown=larp:larp ~/.ssh /home/larp
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable
curl -fsSL https://deb.nodesource.com/setup_22.x -o nodesource_setup.sh && sudo -E bash nodesource_setup.sh && sudo apt install -y nodejs git
# Caddy: follow https://caddyserver.com/docs/install (Debian/Ubuntu apt repo), then:
sudo mkdir -p /var/www/larp-city /etc/larp-city && sudo chown larp /var/www/larp-city
```

Secrets live in `/etc/larp-city/server.env` (mode 600), loaded by systemd:

```ini
# /etc/systemd/system/larp-server.service
[Service]
User=larp
WorkingDirectory=/home/larp/larp-city/server
EnvironmentFile=/etc/larp-city/server.env
ExecStart=/usr/bin/node dist/index.js
Restart=always
[Install]
WantedBy=multi-user.target
```

```
# /etc/caddy/Caddyfile (use ":80 { ... }" to test by IP before DNS is ready)
larpcity.example, www.larpcity.example {
  encode gzip
  handle /api/* { reverse_proxy localhost:3000 }
  handle { root * /var/www/larp-city
           try_files {path} /index.html
           file_server }
}
```

Deploy:

```bash
cd game && npm run build && rsync -az --delete dist/ larp@IP:/var/www/larp-city/
ssh larp@IP 'cd larp-city && git pull && cd server && npm ci && npm run build && sudo systemctl restart larp-server'
```

First time only: `sudo systemctl daemon-reload && sudo systemctl enable --now larp-server && sudo systemctl reload caddy`.

### 3. How it maps to Larp City

One box serves the game and the API with every key server-side; judges play at the public URL.
Stretch: Vultr Serverless Inference (OpenAI-compatible, `https://api.vultrinference.com/v1`) for NPC dialogue strengthens the Vultr story (covered by MLH credit is UNVERIFIED).

### 4. Test first

- [ ] `curl localhost:3000/api/health` on the box, then `curl -I http://IP/` returns 200.
- [ ] `/api/*` works through Caddy, and the service comes back after a reboot.
- [ ] `grep -r API_KEY /var/www/larp-city` finds nothing.

### 5. Gotchas

- A Vultr firewall group, if enabled, can also block ports 80 and 443.
- If Tiger Data has an IP allow list, add the VPS IP.

## Domain (MLH Best Domain Name from GoDaddy Registry)

Prize: a digital gift card; the only stated requirement is to register the domain, so pick a clever name and list it on Devpost.

1. Get this event's promo code from the MLH coach or the HackRice Discord (the code and TLD list are UNVERIFIED; past MLH codes gave a free year of names like .tech, .co, .us, .biz through a GoDaddy Registry partner).
2. Search the name (for example `larpcity.tech`), apply the code, and check out at $0.
3. DNS at the registrar: A record `@` to the Vultr IPv4, CNAME `www` to the apex, delete parking records, TTL 300.
4. Check with `dig +short larpcity.tech A` and `dig @1.1.1.1 larpcity.tech`.
5. Put the name in the Caddyfile and `sudo systemctl reload caddy`; Caddy gets the certificate automatically (`journalctl -u caddy -f`).
6. Test: `curl -I https://<name>` returns 200, www works, and http redirects to https.

Gotchas: certificates fail until ports 80 and 443 are open and DNS resolves, and some TLDs renew at full price after year one.

## .env.example

Only `VITE_`-prefixed variables reach the browser bundle, so no secret may start with `VITE_`.
Commit `.env.example`, keep `.env` gitignored.

```
# ---- server only (never prefix with VITE_) ----
PORT=3000
CORS_ORIGIN=http://localhost:5173

PERSONA_API_KEY=
PERSONA_WEBHOOK_SECRET=
PERSONA_API_VERSION=2025-12-08

NESSIE_API_KEY=
NESSIE_BASE_URL=https://api.nessieisreal.com
NESSIE_TAG=larpcity

ELEVENLABS_API_KEY=
ELEVENLABS_AGENT_ID=
ELEVENLABS_VOICE_NARRATOR=
ELEVENLABS_VOICE_ANCHOR=
ELEVENLABS_WEBHOOK_SECRET=

# Comma-separated; the server rotates to the next key on 429 or 503.
GEMINI_API_KEYS=
GEMINI_TEXT_MODEL=gemini-3.8-flash
GEMINI_IMAGE_MODEL=gemini-3.1-flash-image

DATABASE_URL=postgres://tsdbadmin:PASSWORD@HOST:PORT/tsdb?sslmode=require

BACKBOARD_API_KEY=
BACKBOARD_COACH_ASSISTANT_ID=
BACKBOARD_SMALL_MODEL=
BACKBOARD_LARGE_MODEL=

# Vultr API (deploy scripts only; the app itself never calls it)
VULTR_API_KEY=

# Optional live stock quotes for /debt.html and the phone's Stocks app.
# Read by the Vite dev server (game/vite.config.ts), which proxies /api/market/*; the FRED snapshot is used without it.
ALPHAVANTAGE_API_KEY=

# ---- browser (public) ----
VITE_API_BASE_URL=http://localhost:3000
VITE_PERSONA_TEMPLATE_ID=itmpl_
VITE_PERSONA_ENVIRONMENT_ID=env_
```

## Setup status (2026-09-11, night)

Keys live in `Larp City/.env` on Cayden's laptop (mode 600, gitignored at the repo root and in `game/`); ask Cayden by DM, never paste them in Notion or git.
All accounts are on sixtyfourandten@gmail.com (Nessie is on the `cayden-h` GitHub login).

| Service | Status | What exists | Verified |
| --- | --- | --- | --- |
| ElevenLabs | Done | Key `larp-city` (unrestricted, auto-disable if leaked); agent "Larp City Narrator" `agent_9101m29rg237f79b0rprqav18hxx` (the owl: Daniel on `eleven_v3_conversational`) with the `submit_finances` client tool, five Data collection fields, the post-call webhook, and auth on; narrator and anchor voice Daniel `onwK4e9ZLuTAKqWW03F9` | `/v1/user` 200 (free tier, 0 / 10,000 credits); signed URL returns `wss://` |
| Tiger Data | Done; schema applied and card data loaded (`game/db/load.py`, Sep 11); run recording and the weekly/monthly aggregates built (Sep 12, applied by the server at boot) | Always-free Shared service `larp-city` in AWS us-east-1 (1 GiB, stays free after the trial), inside the 30-day Performance trial project | `psql` connects; TimescaleDB 2.30.0 |
| Backboard | Done, chat needs credits | Key; assistant "Larp City Coach" `fe3bc6b8-0c92-45a1-a0c4-d98d7dd2834a` with research 02, 03, 06 indexed; models `anthropic/claude-haiku-4-5-20251001` (small) and `anthropic/claude-sonnet-5` (large) | `billing/balance` 200; docs indexed. **The free $5 covers only memory and RAG, not LLM chat**, so the coach needs paid credits (or route the coach text through another model) |
| Capital One Nessie | Done; API probed and bank mirror built (Sep 12) | Key from the `cayden-h` GitHub login; the 8 NPC customers, player customers per session, and two probe customers | Every endpoint we use (see the Nessie section); the mirror's statements matched the game's balances end to end |
| Gemini | Done | Three keys in `GEMINI_API_KEYS`, rotated on 429 or 503; no OpenAI (we use Claude Code and ChatGPT in the browser for anything else) | All three: list models 200 (includes `gemini-3.8-flash` and `gemini-3.1-flash-image`), `gemini-3.8-flash` replies (key 2 needed one retry after a 503). Image generation billing not tested |
| Persona | Teammate | | |
| Vultr | Key saved, IP not allowed yet | `VULTR_API_KEY` in `.env` | Returns 401 "Unauthorized IP address" from the Rice network (168.5.164.0); add that IP (or the VPS IP) under Account > API > Access Control |
| Domain | Waiting on the MLH code | | |

## Setup checklist (who does what)

- [ ] Persona: sandbox account, published selfie template with liveness (+ age if allowed), allowed domains, approve workflow, webhook; share template and environment ids.
- [ ] Persona booth: ask for production or credits (Saturday morning).
- [x] Nessie: GitHub login, key, the API probed, and the bank mirror (option B) running against it.
- [x] ElevenLabs: key, narrator and anchor voices, the owl narrator Agent with the `submit_finances` client tool, Data collection, and the post-call webhook; ask for a promo code (promo code still to ask).
- [x] Gemini: three rotating keys in `GEMINI_API_KEYS` (image generation billing still to confirm).
- [x] Tiger Data: ~~trial service~~ (done), ~~save `DATABASE_URL`~~ (done), ~~run the schema~~ (done: `python3 game/db/load.py` applies `game/db/schema.sql` and loads the card catalog and FRED rates).
- [x] Backboard: key, the coach assistant with research docs uploaded (chat needs paid credits).
- [ ] Vultr: redeem the MLH code, Ubuntu 24.04 VPS, Node 22, Caddy, systemd.
- [ ] Domain: MLH code, A record to the VPS.
- [ ] Alpha Vantage (optional live quotes on `/debt.html`): free key from https://www.alphavantage.co/support/#api-key as `ALPHAVANTAGE_API_KEY` in `Larp City/.env` (or `game/.env.local`); the Vite dev server proxies `/api/market/*` and caches for the 25-requests-a-day limit (see `game/.env.example` and research/07). Without it the page uses the FRED snapshot.
- [x] Repo: `server/` (Express, keys from the root `.env`) and `.env.example`; the root `.env` also needs a `SESSION_SECRET`.
- [ ] Share secrets through a password manager or DM, never in Notion or git.

## Prize summary (HackRice 16 Devpost)

| Prize | What we show |
| --- | --- |
| Persona "Prove You're Human" (surprise) | Full mode only for verified adult humans; server-side check; redact on stage |
| Capital One "Best Financial Hack" ($250 per member) | The whole game; live Nessie ledgers |
| ElevenLabs (3 months Scale) and MLH Best Use of ElevenLabs (earbuds) | Voice interview, emotional narrator, news anchor, SFX, captions |
| MLH Best Use of Gemini (swag) | Selfie to avatar, aged future you, structured feedback, news digest |
| MLH Best Use of Tiger Data (Stream Deck Mini) | Hypertables and continuous aggregates behind live charts, leaderboard, rewind |
| MLH Best Use of Backboard (Tile pack) | Coach that remembers past sessions and cites our research |
| MLH Best Use of Vultr (portable screens) | Live URL on Vultr, keys server-side |
| MLH Best Domain Name (gift card) | A punny domain on Devpost |

Devpost is due Sunday 9/13 at 9:00 AM CDT with a 3-4 minute video; one track, any number of challenges.
