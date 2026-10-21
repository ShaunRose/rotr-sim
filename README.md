# ROTR / SIM

A 3D ocean navigation sandbox using Vessel.js and Three.js, separate from Sigma.
Inspired by https://shiplab.github.io/vesseljs/examples/Many_ships_in_regular_ocean.html.

## Run

```bash
npm ci
npm run dev
```

Open http://localhost:3000. Click **Run simulation**, set the target speed,
and move the rudder: negative is port, positive is starboard. **Center rudder**
stops the turn; **Reset** restores the crossing encounter. Time can run at
1x, 5x, or 10x. Pause freezes both the navigation state and wave clock.

## 3D view

- Drag to orbit, scroll/pinch to zoom, and right-drag/two-finger drag to pan.
- **Follow vessel** keeps the camera with your launch. Clicking it again resets
  the camera. **Both vessels** frames the encounter; **Overhead** gives a plan view.
- **Sea** changes the swell amplitude: calm, moderate, or rough.
- Water, reflections, sky, ship geometry, wake textures, and labels are generated
  locally. No external model or texture downloads are needed at runtime.
- A WebGL-capable browser with hardware acceleration is required. The scene
  resizes with its container and releases graphics resources when unmounted.

## Model

- Vessel.js constructs the 20 x 6 x 4 m box hull and computes submerged volume
  and displacement at 1.5 m draft, using seawater density 1025 kg/m3.
- `app/sim/model.mjs` owns the state, fixed-step advancement, and constant-velocity
  closest-approach prediction. Coordinates are metres east/north, headings are
  clockwise from north, and speeds are knots.
- `app/sim/ocean-scene.tsx` renders the hulls and superstructures using Three.js,
  with OrbitControls, the Sky atmosphere, and the reflective Water shader.
  A two-component regular swell displaces the ocean surface. Sampling that same
  surface at the hull centre, bow/stern, and sides drives heave, pitch, and roll.
- Speed approaches its target over a four-second time constant. Rudder sets
  a speed-dependent turn rate. Steering and wave-following are illustrative,
  not calibrated hydrodynamics or Vessel.js WaveMotion response calculations.
  Hull contact pauses the simulation; impacts do not apply bounce or damage.
- The amber vessel holds 270 degrees at 6 knots. The initial courses intersect.
  Boats continue outside the starting scenario area; the camera follows them.
- `vendor/` contains the standalone Vessel.js 0.0.14 module and MIT license;
  see `vendor/README.md` for provenance.

## Collisions

Hull contact uses the separating axis theorem on both oriented 20 x 6 m hull
footprints, including edge contact. The model checks each 1/30-second step;
wave heave, pitch, roll, railings, and fenders are excluded from this horizontal
footprint. This is discrete contact detection for the current speed range.

On impact, the model records simulation time and latches the collision state.
Navigation and wave time freeze, both hulls glow red with red outlines, and
an alert offers **Restart encounter**. Playback and helm controls remain
locked until reset. Speeds shown at impact are the frozen pre-impact speeds;
there is no rigid-body impulse or damage model.

To reproduce, reset, leave 6 kn / amidships, and run at 10x. Contact occurs at
about 93 simulation seconds (roughly 9.3 real seconds at full frame rate).
Turn early to avoid the encounter. Closest-approach prediction remains a
separate warning; only actual hull contact triggers the stop.

## Sigma integration boundary

Sigma is not connected yet. A future worker or service can consume the state
from `initialState` / `advance` and return `{ speed, rudder }` commands. Keep
ontology loading and theorem proving outside the rendering loop. Associate
reasoning responses with a simulation state revision before applying them.
The renderer reads the existing live state; it does not own the navigation model.

## Checks

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
```
