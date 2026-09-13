# Pixel world: progress and deviations

Spec: [2026-09-13-pixel-world-design.md](../specs/2026-09-13-pixel-world-design.md).
Plan: [2026-09-13-pixel-world.md](2026-09-13-pixel-world.md).

## Performance

Measured in Chrome on the full SF world (seed 20260912), canvas 2400 x 1930 at device pixel ratio 2.
The window was in the background during testing, so `requestAnimationFrame` did not run; frame cost is measured instead by rendering the stage 40 times synchronously and reading back one pixel after each render so the GPU finishes (`__bench` in the progress notes below).

| Zoom | Before (ms per frame) | After (ms per frame) |
|---|---|---|
| Max zoom-out (0.472) | 12.59 | |
| 1 | 7.67 | |
| 2 | 8.21 | |

## Deviations from the spec

None yet.
