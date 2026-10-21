import { Ship } from "../../vendor/vessel.mjs";

export const KNOT = 1852 / 3600;
export const STEP = 1 / 30;
export const WORLD = { width: 1200, height: 800 };
export const hull = { length: 20, beam: 6, depth: 4, draft: 1.5 };

/** Build a simple rectangular displacement hull using Vessel.js. */
export function createVessel() {
  const ship = new Ship({
    attributes: { name: "Research launch" },
    designState: { calculationParameters: {}, objectOverrides: {} },
    structure: {
      hull: {
        attributes: { LOA: hull.length, BOA: hull.beam, Depth: hull.depth },
        halfBreadths: { waterlines: [0, 1], stations: [0, 0.5, 1], table: [[1, 1, 1], [1, 1, 1]] },
      },
      decks: {}, bulkheads: {},
    },
    baseObjects: [], derivedObjects: [],
  });
  const hydrostatics = ship.structure.hull.calculateAttributesAtDraft(hull.draft);
  return { ship, volume: hydrostatics.Vs, displacement: hydrostatics.Vs * 1025 / 1000 };
}

/** Clockwise degrees from north. Coordinates are metres east and north. */
export function initialState() {
  return {
    time: 0,
    collision: /** @type {{ time: number } | null} */ (null),
    own: { x: 360, y: 240, heading: 0, speed: 6, trail: [[360, 240]] },
    target: { x: 660, y: 540, heading: 270, speed: 6, trail: [[660, 540]] },
  };
}

/**
 * Test the horizontal 20 x 6 m hull footprints using the separating axis theorem.
 * Edge contact counts as a collision. Visual wave pitch/roll do not change the footprint.
 * @param {{ x: number, y: number, heading: number }} a
 * @param {{ x: number, y: number, heading: number }} b
 */
export function hullsOverlap(a, b) {
  const axes = (boat) => {
    const angle = boat.heading * Math.PI / 180;
    return [[Math.sin(angle), Math.cos(angle)], [Math.cos(angle), -Math.sin(angle)]];
  };
  const aa = axes(a), ba = axes(b);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
  const radius = (basis, axis) => hull.length / 2 * Math.abs(dot(basis[0], axis))
    + hull.beam / 2 * Math.abs(dot(basis[1], axis));
  const delta = [b.x - a.x, b.y - a.y];
  return [...aa, ...ba].every(axis => Math.abs(dot(delta, axis)) <= radius(aa, axis) + radius(ba, axis) + 1e-9);
}

/** Advance the steering model, latching and freezing at the first detected contact. */
export function advance(state, command, dt) {
  if (state.collision) return state;
  if (hullsOverlap(state.own, state.target)) return { ...state, collision: { time: state.time } };
  const move = (boat, own) => {
    const speed = own ? boat.speed + (command.speed - boat.speed) * (1 - Math.exp(-dt / 4)) : boat.speed;
    const heading = (boat.heading + (own ? command.rudder / 35 * speed / 12 * 5 * dt : 0) + 360) % 360;
    const angle = heading * Math.PI / 180;
    const x = boat.x + Math.sin(angle) * speed * KNOT * dt;
    const y = boat.y + Math.cos(angle) * speed * KNOT * dt;
    const last = boat.trail[boat.trail.length - 1];
    const trail = Math.hypot(x - last[0], y - last[1]) >= 3 ? [...boat.trail.slice(-299), [x, y]] : boat.trail;
    return { x, y, heading, speed, trail };
  };
  const next = { time: state.time + dt, collision: state.collision, own: move(state.own, true), target: move(state.target, false) };
  if (hullsOverlap(next.own, next.target)) next.collision = { time: next.time };
  return next;
}

/** Closest approach assuming both boats hold their current velocity. */
export function encounter(state) {
  const velocity = (boat) => {
    const a = boat.heading * Math.PI / 180;
    return [Math.sin(a) * boat.speed * KNOT, Math.cos(a) * boat.speed * KNOT];
  };
  const a = velocity(state.own), b = velocity(state.target);
  const dx = state.target.x - state.own.x, dy = state.target.y - state.own.y;
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const vv = vx * vx + vy * vy;
  const tcpa = vv < 1e-9 ? 0 : Math.max(0, -(dx * vx + dy * vy) / vv);
  return { range: Math.hypot(dx, dy), tcpa, dcpa: Math.hypot(dx + vx * tcpa, dy + vy * tcpa) };
}
