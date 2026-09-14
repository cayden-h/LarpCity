# Notion backup - Larp City page, before adding the API setup section (2026-09-11)

Page: https://app.notion.com/p/Larp-City-3d846cd8aa24804a9c63c8bfc95a5e6b
Page id `3d846cd8-aa24-804a-9c63-c8bfc95a5e6b`, space `43555b91-61bf-4007-a4b1-b8753c13b872`.

The setup update adds a new top-level "🔌 Setup & API Keys" toggle heading after "🛠️ Tech Stack", one bullet at the end of "🧑 Avatar & Persona", and one "Backend" bullet in "🛠️ Tech Stack" after "Integrations".
The only edited block is the Tech Stack "Simulation" bullet, changed from "seeded weekly tick engine" to "seeded daily tick engine" to match the Sep 11 meeting (its old text is below).
No block is deleted.
To undo it, remove the blocks added after this date.
Full text history is in Notion's page history.

## Follow-up: per-track steps (2026-09-11, later the same night)

A second write adds one step-by-step sub-section per sponsor track (Capital One Nessie, ElevenLabs, Gemini, Tiger Data, Vultr, Backboard, Domain) inside "🔌 Setup & API Keys" (block `d76dcc9c-9c29-46ea-b600-ce58b2d14e18`), right after the last Persona step (`2bae7843`).
It only adds blocks; the 37 existing children of that section (all written by Claude earlier the same night) are not edited.
By then the page also had "💳 Debt & Credit" (`09ace278`) and "Research: Debt & Credit" (`0a47e3a0`), added by another session.

## Top-level blocks before the change

| # | Block id | Type | Title | Children |
| --- | --- | --- | --- | --- |
| 0 | c8059bb3-6e95-4239-88f3-afeae10a2048 | toggle heading | 🎯 Purpose | 4 |
| 1 | 785b9f53-1012-4a83-9645-cdbb96667976 | toggle heading | 🕹️ Core Features | 19 |
| 2 | 589787e2-a271-4050-a7cf-132c8b6404a2 | toggle heading | 🗓️ Game Design Meeting (Sep 11) | 35 |
| 3 | 46c2e812-b1fe-4dda-a8fb-54a31f6ab1cd | toggle heading | 🗺️ States & Cities | 17 |
| 4 | 9e5f5b09-a1bc-44a1-b6a2-9ddb49ac04e4 | toggle heading | 🎨 City Visuals & Traffic | 11 |
| 5 | 42c3913a-1330-4011-9520-156d17e82d34 | toggle heading | ⚡ Events | 19 |
| 6 | 426ba989-5212-4d83-856b-58da2edf9aef | toggle heading | 📈 Stock Market & Simulation | 11 |
| 7 | 3f568de1-cc5e-4c98-8f57-3f1c1d643cd9 | toggle heading | 🧑 Avatar & Persona | 8 |
| 8 | 23cba98e-0e4f-40a7-922a-9aa753935f84 | toggle heading | 🧠 Learning Design & Impact | 17 |
| 9 | 816dbf57-18b7-4c9c-b53f-4350878fb20c | toggle heading | 🛠️ Tech Stack | 13 |
| 10 | 1c6dad07-f078-4216-b218-7ec8a559af42 | toggle heading | 🏆 Hackathon: Deadlines & Prizes | 46 |
| 11 | 27424dba-446e-4204-ba0c-3f04c1950bad | toggle heading | ❓ Open Questions | 29 |
| 12 | c0618d8b-55ce-4761-ba87-f238b18285b3 | divider | | 0 |
| 13 | 0f33a702-6392-4de3-b4ff-d02b959f04cb | header | 📚 Research & Docs | 0 |
| 14 | 564554e2-dee3-4f11-bf28-efbc92432b91 | text | Full research from Sep 11, one page per topic... | 0 |
| 15 | 8ea1ead8-f511-448b-88b6-73b96458d319 | page | ChatGPT Brief (Research Summary) | 75 |
| 16 | 6686facf-be18-4414-88d2-874fb89dfadf | page | Research: Avatar & Persona | 93 |
| 17 | 1ffd7352-31b1-40d3-9e7f-c7b53c39fc9b | page | Research: States & Cost of Living | 101 |
| 18 | 72b223ee-ed2b-413d-9028-7a7c53be387e | page | Research: Stock Market & Simulation | 151 |
| 19 | d9b9edfc-337c-4632-808c-a9d69f9463ce | page | Research: Impact, Learning & Judging | 119 |
| 20 | b2ad33e6-8b82-45d4-8766-93377d8e6236 | page | Research: City Visuals & Art Pipeline | 116 |
| 21 | a50d239f-4150-4c91-a907-b7fbddd060ce | divider | | 0 |
| 22 | 223edc48-ee54-4b3b-9445-a59713345646 | toggle heading | 🗂️ Original brainstorm notes (verbatim, before reorganizing) | 24 |

## Tech Stack section before the change (verbatim)

- Game: Vite + TypeScript, PixiJS v8 isometric map, with the HUD and pop-ups as regular web UI over the canvas.
- Why PixiJS over Phaser: the LEGO City game we are copying is itself built on PixiJS (pixi.js-legacy + Howler for sound), and we need sprites plus our own simulation, not physics.
- Simulation: deterministic, seeded weekly tick engine in TypeScript, running in the browser.
- Data: static states.json, built ahead of time.
- Integrations: Persona Web SDK plus a small server; Gemini for avatars and recaps; ElevenLabs for voice; Capital One Nessie as the bank API.
- Sponsor tools (MLH prizes): Tiger Data database for weekly NPC and city data, Vultr hosting with a GoDaddy domain, and Backboard for AI memory and RAG (see the MLH prize plan in the Hackathon section).
- PixiJS showcase
- (remaining blocks are links)

## Avatar & Persona section before the change (verbatim, first 6 blocks)

1. Consent screen: a short notice with "I agree" or "Skip - pick an avatar" (Texas biometric law requires notice and consent before capture).
2. Capture: take one photo with the browser camera and keep it in memory only.
3. Persona check: the embedded Web SDK (free Sandbox) runs selfie liveness plus an 18+ age check; the server confirms the result, then deletes the Persona data (Redact Inquiry).
4. Avatar: Gemini 3.1 Flash Image turns the selfie plus one sprite from our art pack into a cartoon turnaround sheet (about $0.07 and 10-20 s); we slice it into 8 directions.
5. Fallbacks: gpt-image-2, then a pick-your-parts avatar (which also makes the NPCs), then pre-made avatars saved in the app for a no-Wi-Fi demo.

- Test in hour 1: does Persona Sandbox give back the real selfie or a sample image?
