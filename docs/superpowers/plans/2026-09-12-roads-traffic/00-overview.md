# Roads and Traffic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace tile-by-tile random traffic with a vector road network (road classes, lane counts, controlled intersections) and a deterministic trip-based traffic simulation.

**Architecture:** Cities and the world builder emit `RoadDef` vectors; tiles are stamped from them so lots and the ground keep reading tiles.
`engine/roads/` builds a graph (nodes, straight segments, lanes, Bezier movements, conflict tables, control), and a headless fixed-step sim drives cars with IDM car-following, intersection admission rules, lane changes, A* trips, parking, buses, and pedestrians at crosswalks.
PixiJS code only renders the sim's state.

**Tech Stack:** TypeScript (erasable syntax only), PixiJS v8, Node's built-in test runner (`node --test`, Node 23+ type stripping).

**Spec:** [../../specs/2026-09-12-roads-traffic-design.md](../../specs/2026-09-12-roads-traffic-design.md)

---

## Ground rules for every task

- Work in the worktree `/Users/cayden/Documents/GitHub/HackRice/larp-roads` on branch `roads-traffic`; run commands from `game/`.
- Every relative runtime import in a file that tests load must end in `.ts` (Node's type stripping needs it; `allowImportingTsExtensions` is on). `import type` lines may stay extension-less.
- New files under `src/engine/roads/` must not import `pixi.js`, except `draw.ts`.
- No enums, namespaces, or constructor parameter properties (`erasableSyntaxOnly`); no unused locals or parameters.
- After each task: `npx tsc --noEmit -p tsconfig.json` and `npm test` both pass, then commit.
- Commit messages: a short plain sentence, no agent co-author line (Cayden's rule).
- Never use em dashes in code comments or docs.

## Task list

| # | File | Task |
|---|---|---|
| 1 | [01-road-defs.md](01-road-defs.md) | Road types, `LayoutBuilder` records roads, `O` tile, testable imports |
| 2 | [02-city-layouts.md](02-city-layouts.md) | Six cities and the templates emit roads with arterials |
| 3 | [03-geometry.md](03-geometry.md) | `Path` and Bezier helpers |
| 4 | [04-graph.md](04-graph.md) | Graph: nodes, segments, lanes, movements, conflicts, reachability |
| 5 | [05-control.md](05-control.md) | Intersection control, signal plans, crosswalks |
| 6 | [06-world-roads.md](06-world-roads.md) | World builder emits the road hierarchy, ring highway, interchanges |
| 7 | [07-sim-core.md](07-sim-core.md) | Sim core: IDM, admission, lane changes, watchdog |
| 8 | [08-router-trips.md](08-router-trips.md) | A* router, places, parking, demand, buses, cable cars |
| 9 | [09-traffic-render.md](09-traffic-render.md) | `Traffic` renders the sim; 8-facing vehicles |
| 10 | [10-ground-props.md](10-ground-props.md) | Markings from the network, overpass decks, signals and signs |
| 11 | [11-people.md](11-people.md) | Pedestrians on sidewalks and crosswalks |
| 12 | [12-integrate.md](12-integrate.md) | Scene wiring, city tests at scale, docs, browser check |

Tasks run in order; each leaves the game building and running.
