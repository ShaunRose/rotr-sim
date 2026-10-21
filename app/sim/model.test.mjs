import test from "node:test";
import assert from "node:assert/strict";
import { advance, createVessel, encounter, hull, hullsOverlap, initialState, KNOT, STEP } from "./model.mjs";

test("Vessel.js warship hull displaces its design-draft volume", () => {
  const vessel = createVessel();
  const volume = hull.length * hull.beam * hull.draft;
  assert.ok(Math.abs(vessel.volume - volume) < 1e-6);
  assert.ok(Math.abs(vessel.displacement - volume * 1.025) < 1e-6);
});

test("initial crossing courses predict a collision after about 165 seconds", () => {
  const cpa = encounter(initialState());
  assert.ok(cpa.dcpa < 1e-8);
  assert.ok(cpa.tcpa > 165 && cpa.tcpa < 166);
});

test("straight course travels north in metres while the target travels west", () => {
  const before = initialState();
  const after = advance(before, { speed: 20, rudder: 0 }, 1);
  assert.equal(after.own.x, before.own.x);
  assert.ok(Math.abs(after.own.y - before.own.y - 20 * KNOT) < 1e-8);
  assert.ok(after.target.x < before.target.x);
  assert.equal(before.time, 0);
});

test("starboard rudder turns clockwise and speed approaches the command", () => {
  let state = initialState();
  for (let i = 0; i < 300; i++) state = advance(state, { speed: 10, rudder: 35 }, STEP);
  assert.ok(state.own.heading > 0 && state.own.heading < 90);
  assert.ok(state.own.x > initialState().own.x);
  assert.ok(state.own.speed > 10 && state.own.speed < 20);
});

test("equal velocity and opening encounters give finite closest approach", () => {
  const state = initialState();
  state.target.heading = 0;
  assert.equal(encounter(state).tcpa, 0);
  state.target.heading = 90;
  assert.equal(encounter(state).tcpa, 0);
  assert.ok(Number.isFinite(encounter(state).dcpa));
});

test("parallel hulls collide at side and end contact, but not across a gap", () => {
  const own = { x: 0, y: 0, heading: 0 };
  assert.equal(hullsOverlap(own, { x: hull.beam, y: 0, heading: 0 }), true);
  assert.equal(hullsOverlap(own, { x: hull.beam + 0.001, y: 0, heading: 0 }), false);
  assert.equal(hullsOverlap(own, { x: 0, y: hull.length, heading: 180 }), true);
  assert.equal(hullsOverlap(own, { x: 0, y: hull.length + 0.001, heading: 180 }), false);
});

test("perpendicular hulls detect corner contact and a near miss", () => {
  const own = { x: 0, y: 0, heading: 0 };
  const corner = (hull.length + hull.beam) / 2;
  assert.equal(hullsOverlap(own, { x: corner, y: corner, heading: 90 }), true);
  assert.equal(hullsOverlap(own, { x: corner + 0.001, y: corner, heading: 90 }), false);
  assert.equal(hullsOverlap(own, { x: 0, y: 0, heading: 90 }), true);
});

test("separated parallel hulls do not collide", () => {
  const own = { x: 0, y: 0, heading: 0 };
  const target = { x: 0, y: hull.length + 1, heading: 0 };
  assert.equal(hullsOverlap(own, target), false);
  assert.equal(hullsOverlap(target, own), false);
});

test("rotated hulls use oriented footprints rather than axis-aligned bounds", () => {
  const own = { x: 200, y: -50, heading: 45 };
  const offset = (hull.beam + 0.001) / Math.sqrt(2);
  const target = { x: own.x + offset, y: own.y - offset, heading: 45 };
  assert.equal(hullsOverlap(own, target), false);
  assert.equal(hullsOverlap(target, own), false);
  target.x = own.x + (hull.beam - 0.1) / Math.sqrt(2);
  target.y = own.y - (hull.beam - 0.1) / Math.sqrt(2);
  assert.equal(hullsOverlap(own, target), true);
});

test("default encounter latches first contact and cannot advance until reset", () => {
  let state = initialState();
  let previous = state;
  const command = { speed: 20, rudder: 0 };
  for (let i = 0; i < 18000 && !state.collision; i++) {
    previous = state;
    state = advance(state, command, STEP);
  }
  assert.ok(state.collision);
  assert.ok(state.collision.time > 156 && state.collision.time < 158);
  assert.equal(hullsOverlap(previous.own, previous.target), false);
  assert.equal(hullsOverlap(state.own, state.target), true);
  assert.equal(state.collision.time, state.time);
  assert.equal(advance(state, { speed: 12, rudder: 35 }, STEP), state);
  const reset = initialState();
  assert.equal(reset.collision, null);
  assert.ok(advance(reset, command, STEP).time > 0);
});

test("initial hull contact is recorded before the boats move apart", () => {
  const state = initialState();
  state.target = { ...state.target, x: state.own.x + (hull.length + hull.beam) / 2, y: state.own.y, heading: 90 };
  const next = advance(state, { speed: 20, rudder: 0 }, STEP);
  assert.deepEqual(next.collision, { time: 0 });
  assert.equal(next.time, 0);
  assert.equal(next.own, state.own);
});

test("early starboard maneuver avoids the default collision", () => {
  let state = initialState();
  for (let i = 0; i < 3600; i++) state = advance(state, { speed: 20, rudder: 35 }, STEP);
  assert.equal(state.collision, null);
  assert.ok(state.time > 119);
});

test("vessel state records applied rudder separately from pending helm commands", () => {
  const before = initialState();
  const command = { speed: 10, rudder: 20 };
  assert.equal(before.own.rudder, 0);
  const after = advance(before, command, STEP);
  assert.equal(after.own.rudder, 20);
  assert.equal(after.target.rudder, 0);
  assert.equal(before.own.rudder, 0);
  assert.ok(after.own.speed > command.speed && after.own.speed < before.own.speed);
  assert.equal(after.target.speed, 20);
});
