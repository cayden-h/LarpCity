# Roads and traffic: a real road network and trip-based driving

## Goal

Replace the tile-by-tile random traffic with a real road network and a traffic simulation that behaves like a city: road classes with real lane counts, controlled intersections, smooth turns, cars that drive routed trips on a rush-hour schedule and park, and pedestrians that cross at crosswalks.

This is the first of three sub-projects from the 2026-09-12 roads brainstorm:

- A+B. Road network model and traffic simulation (this spec).
- C. Street visuals: pixel-art car sprites in 8 facings, signal heads, signs, and markings in the pixel style.
- D. Boats: waterway routes, docks and marinas, turning and yielding boats, pixel boat sprites and wakes.

It also takes over sub-project 4 ("Streets") of [2026-09-12-blender-houses-design.md](2026-09-12-blender-houses-design.md) on branch `blender-houses`.
Water texture and animation (its sub-project 3) stays with that effort.

## Decisions (from brainstorming, 2026-09-12)

- Roads come in mixed widths: local streets and collectors are 1 tile, arterials 2 tiles, highways 2 or 3 tiles.
- Cars drive trips (origin to destination) with rush-hour demand, not random wandering.
- The road network is a vector model and is the source of truth; the tile grid is rasterized from it.
- Everything drawn follows the pixel art direction; this spec keeps drawing functional, and spec C does the final pixel art.

## 1. Road network model (`game/src/engine/roads/`)

### Road classes

| Class | Width | Lanes | Speed (tiles/s) | Notes |
|---|---|---|---|---|
| `local` | 1 tile | 1 each way | 0.8 | Curb parking; cul-de-sacs allowed |
| `collector` | 1 tile | 1 each way | 1.0 | Suburb spines, bus routes |
| `arterial` | 2 tiles | 2 each way | 1.25 | Double yellow center, left-turn pocket at signals |
| `highway` | 2 or 3 tiles | 2 or 3 each way | 1.8 | Grade-separated, reached only by ramps |
| `ramp` | 1 tile | 1, one-way | 1.2 | Merges into or diverges from a highway |

A country road is a `local` with `rural: true`, which raises its speed to 1.3.
Tram and bridge are flags on a road, not classes.

### `RoadDef`

```ts
interface RoadDef {
  id: string;
  cls: "local" | "collector" | "arterial" | "highway" | "ramp";
  /** Centerline in tile coordinates; axis-aligned segments only. */
  path: [number, number][];
  /** Lanes in the path's direction and against it (0 against = one-way). */
  lanes: [number, number];
  tram?: boolean;
  rural?: boolean;
}
```

- A 1-tile road's centerline runs through tile centers (x + 0.5); a 2-tile road's centerline runs on the tile edge between its two rows, and a 3-tile road's through the middle row's center.
- Every lane is 0.5 tile wide, so each 1-tile row of road holds two lanes; lane offsets are measured from the centerline, and traffic keeps right.
- `CityDef` gains `roads: RoadDef[]`; the layout strings stay for everything that is not road.

### Graph (`roads/graph.ts`)

- Nodes: intersections (two or more roads meet or cross), merges and diverges (ramp ends), and dead ends.
- Segments: the stretch of a road between two nodes; each carries its lanes as polylines in continuous tile space, trimmed back from the node by the intersection's radius.
- Movements: at each node, every allowed (entry lane, exit lane) pair, with a cubic Bezier connector from the lane's end to the exit lane's start.
  - Right turns come from the rightmost lane, left turns from the leftmost lane (the turn pocket on arterials), straight from any lane that lines up.
  - U-turns are allowed only at dead ends (cul-de-sacs) and at the end of a trip.
- Conflicts: for each node, a precomputed table of which movements cross or merge, found by intersecting their connector curves (sampled), plus which crosswalks each movement crosses.

### Intersection control (`roads/control.ts`)

Assigned by the classes that meet, highest pair wins:

| Meeting | Control |
|---|---|
| arterial with arterial or collector | Signal |
| collector with collector | All-way stop |
| any core (hand-made) street with another core street, below arterial | All-way stop |
| local with collector or arterial | Stop sign on the local |
| local with local, outside the core | Yield on the road with fewer lanes, then on the one entering from the side |
| highway with anything | Grade-separated: no node, the other road passes on an overpass |
| ramp end on a highway | Merge (onto) or diverge (off) |
| ramp end on a street | Stop sign (off-ramp) or signal when the street is an arterial |


### Rasterization (`roads/raster.ts`)

- Every road stamps its tiles: `=` for street, `B` over water, `t` for tram, and a new `O` for an overpass (a road over another road).
- The ground paints markings from the network's segments and nodes (`roads/marks.ts`) instead of guessing from neighboring tiles; tiles keep only asphalt, curbs, and tram rails.
- Frontage, lots, `populate.ts`, and the houses work keep reading tiles unchanged.
- `CityGrid.isRoad` includes `O`; `roadLinks` is kept for people and old callers until they move to the network.

## 2. Map layout

### Hand-made cores

- `LayoutBuilder` gains `road(cls, path, opts)`, which records a `RoadDef` and rasterizes it; `roadX` and `roadY` become shorthands for a `local` road.
- `build()` returns `{ layout, roads }`.
- Each of the six cities gets 1 to 3 arterials; widening a street to 2 tiles takes one row of frontage lots.
  - San Francisco: the Embarcadero (rows 6-7) and the main avenue (columns 27-28, waterfront to the southern hills).
  - Houston: rows 8-9 across the channel and columns 13-14; Dallas: the doubled streets at rows 12-13 and columns 23-24 become single arterials; Austin: rows 14-15 and columns 24-25; New York: Fifth Avenue (columns 19-20) and rows 24-25; Miami: columns 6-7 and the island spine (columns 24-25).
  - Every choice was checked against landmark footprints and home tiles; streets whose bridge landmark is one tile wide (the Golden Gate, the Congress Avenue bat bridge, Houston's row 20 crossing) stay two-lane.
- The state templates (`templates.ts`) get one arterial through their center.
- Coordination: the houses spec places SF home lots by hand next to roads; SF's widened rows change which lots exist, so home lots are placed after this change lands, against the new layout.

### Generated world (`world.ts`)

The terrain, lots, farms, and features parts stay; the road part is rewritten to emit `RoadDef`s:

- A perimeter road hugs the core, and a frontage road runs along the suburbs' outer edge; suburban collectors end on it.
- Arterials that leave the core continue straight to the world's edge; more arterials repeat every 12 tiles through the suburb ring and also run on to the edge.
- A 2-tile highway ring replaces the beltway at the suburb ring's edge, with a diamond interchange (overpass plus 4 ramps) wherever an arterial crosses it.
- One radial highway leaves the ring along the city's main axis to the world's edge, with an interchange at the ring.
- Suburbs: collectors every 6 tiles; local streets between them, some ending in cul-de-sacs so blocks are not a perfect grid.
- Rural: country roads (`local`, `rural`) every 12 tiles as today, stopping at open water.
- Water crossings up to 5 tiles become bridges as today; highways may bridge up to 8.
- Roads continue out of the core only where the core road reaches its edge (the current rule).

## 3. Traffic simulation (`game/src/engine/roads/sim.ts`)

No PixiJS in the sim, so it runs headless in tests.

### Stepping

- Fixed step of 1/20 s of real time, seeded from the city seed; `Traffic.update(dt)` runs as many steps as the frame's time covers (at most 5, so a hitch does not spiral) and interpolates positions for drawing.
- The sim reads the hour from the clock each step for trip demand; it does not follow the calendar's fast-forward (traffic is scenery at real speed).

### Driving

- Longitudinal: the Intelligent Driver Model per car, with each class's speed as the desired speed, and per-kind parameters (buses and cable cars accelerate slower, taxis a little more aggressively).
- A car's position is (lane or movement, distance along it); its leader is the next car ahead on the same lane or on the movement it has committed to.
- Lane changes on multi-lane segments: a car moves toward the lane its next movement needs, starting at least 3 tiles before the node; it changes only when the target lane's gaps ahead and behind are safe (a simplified MOBIL), and slows to find a gap if needed. The change is drawn as a smooth sideways blend over 0.6 s.

### Intersections

A car may enter a movement only when all three hold:

1. The control allows it: a green signal for its movement; its turn at an all-way stop (first to stop, first to go, after a full stop); or, at a stop or yield, an accepted gap in the conflicting priority traffic.
2. No conflicting movement is occupied or reserved by another car.
3. Its exit lane has room for the car's length plus a gap ("don't block the box").

Also:

- Left turns without a protected arrow yield to oncoming straight and right-turning traffic; right turns yield to people in the crosswalk they cross.
- Signals run phase plans: green, yellow (3 s), all-red (1 s); arterials get a protected left arrow phase; a signal's plan is built from the approaches it has.
- Signals along an arterial get offsets from their distance along it, so a car at the arterial's speed meets a run of greens.
- A watchdog: if a node has had waiting cars and no movement for 20 s, the car that has waited longest goes when its conflicts are clear.

### Trips

- Places: lots from `populate.ts`, tagged by zone: residential (homes), downtown, midtown, industrial, campus (work), and midtown and plaza-adjacent lots (errands).
- Each place maps to its nearest local or collector segment and a curb spot on it.
- Demand by the clock's hour: 7 to 9, home to work; 16 to 19, work to home; 11 to 14, errands; 22 to 5, sparse; the rest a light mix.
- The economy, weather, and pandemic multipliers in `scene.ts` now scale the trip rate instead of a flat car count; `city.traffic` becomes the peak number of moving cars.
- Routing: A* over the graph with free-flow travel time plus a light congestion term (cars on the segment), recomputed only when a trip starts.
- A trip pulls out from its origin's curb spot into the lane, drives the route, and parks at the destination's curb spot.
- Parked cars stay drawn at the curb and block that parking spot only; they dwell a while (hours of game time for work trips, less for errands), then leave on their next trip or fade out if demand has dropped.
- If a trip's destination spot is taken, the car parks at the nearest free spot on the same or a neighboring segment.

### Special vehicles

- Buses: 1 to 3 fixed loops per city along collectors and arterials, built from the graph; a bus stops at bus stops every 4 to 6 tiles for a few seconds.
- Cable cars: loop along the tram roads only (SF).
- Taxis and police: random trips between any places; they do not park, and at the trip's end pick a new one.
- The existing `VehicleKind` weights choose the mix of trip cars.

### Pedestrians (`people.ts`)

- Street walkers keep to the sidewalks and cross the road only at crosswalks: at signals on the walk phase, at stop-controlled corners when no car is inside the movement they cross.
- Crosswalks are drawn only where people cross: at every signal and every all-way stop.
- A person in a crosswalk is a conflict for the movements crossing it.
- Plaza strollers are unchanged.

### Performance

- At most 250 moving cars and 400 parked cars.
- Leader lookup is per lane (cars kept in order on each lane); conflict checks are per node; nothing is all-pairs.
- The sim step targets under 1 ms for 250 cars on a mid laptop.

## 4. Drawing

This spec keeps drawing functional and pixel-clean where it is cheap; spec C replaces cars and props with pixel-art sprites.

- `ground.ts` draws roads from the network: asphalt per road piece, curbs where the road meets land, dashed white lane lines, a double yellow center on arterials, solid edge lines on highways, stop bars at stop and signal approaches, crosswalks where people cross, and turn arrows in turn pockets.
- Overpasses are drawn with the bridge deck at `BRIDGE_Z` over the road below.
- Signal heads (red, yellow, green, left arrow) and stop and yield signs are simple props at the node's corners, sorted by depth like other objects; signal lamps glow at night like car lamps.
- Cars are drawn at any heading along curves by choosing the nearest of 8 facings; `drawVehicle` gains the two diagonals, and headlights follow the heading.
- The `Traffic` class keeps its constructor and its `setTarget`, `count`, `tint`, and `update` surface, so `scene.ts` changes only where it builds the network.
- Boats are untouched here (spec D).

## 5. Verification

Headless tests (`game/tests/roads-*.test.ts`, `node --test`), run for all six hand-made cities and every template:

- Graph: every lane can reach every other lane's segment; the only dead ends are cul-de-sacs, where U-turns exist.
- Raster: the tiles stamped from the network match the grid; no road tile lacks a road piece.
- Control: no two conflicting movements are ever green at the same time, checked over a full signal cycle at every signal.
- Sim, 30 simulated minutes across a morning rush:
  - no two cars ever overlap (distance between car centers at least their half-lengths summed, on the same lane or crossing movements);
  - no gridlock: every node with approaching cars lets at least one through in every 60 s window;
  - the same seed gives the same state after N steps;
  - during 7 to 9, more trips end in work zones than in homes, and the reverse from 16 to 19.
- Performance: a sim step with 250 cars stays under 1 ms on average (reported, not a hard CI gate).

In the browser, every city at three zoom levels, day and night: signals cycling, cars stopping at stop lines, protected and permitted lefts, all-way stops taking turns, highway merges and exits, parking and pulling out, buses at stops, and people crossing on the walk signal.
`npm run build` and `npm test` stay green.

## Out of scope

- Pixel-art car and prop sprites (spec C).
- Boats and water routes (spec D); water texture and animation (the houses effort).
- Diagonal or curved road centerlines; only lane paths curve.
- Accidents, emergency vehicles with sirens, and road construction.
- Traffic following the calendar's fast-forward speed.
