import test from "node:test";
import assert from "node:assert/strict";
import { advance, createVessel, encounter, hullsOverlap, initialState, KNOT, STEP } from "./model.mjs";

test("Vessel.js box hull displaces 180 cubic metres at design draft", () => {
  const vessel = createVessel();
  assert.ok(Math.abs(vessel.volume - 180) < 1e-6);
  assert.ok(Math.abs(vessel.displacement - 184.5) < 1e-6);
});

test("initial crossing courses predict a collision after about 97 seconds", () => {
  const cpa = encounter(initialState());
  assert.ok(cpa.dcpa < 1e-8);
  assert.ok(cpa.tcpa > 97 && cpa.tcpa < 98);
});

test("straight course travels north in metres while the target travels west", () => {
  const before = initialState();
  const after = advance(before, { speed: 6, rudder: 0 }, 1);
  assert.equal(after.own.x, before.own.x);
  assert.ok(Math.abs(after.own.y - before.own.y - 6 * KNOT) < 1e-8);
  assert.ok(after.target.x < before.target.x);
  assert.equal(before.time, 0);
});

test("starboard rudder turns clockwise and speed approaches the command", () => {
  let state = initialState();
  for (let i = 0; i < 300; i++) state = advance(state, { speed: 10, rudder: 35 }, STEP);
  assert.ok(state.own.heading > 0 && state.own.heading < 90);
  assert.ok(state.own.x > 360);
  assert.ok(state.own.speed > 9 && state.own.speed < 10);
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
  assert.equal(hullsOverlap(own, { x: 6, y: 0, heading: 0 }), true);
  assert.equal(hullsOverlap(own, { x: 6.001, y: 0, heading: 0 }), false);
  assert.equal(hullsOverlap(own, { x: 0, y: 20, heading: 180 }), true);
  assert.equal(hullsOverlap(own, { x: 0, y: 20.001, heading: 180 }), false);
});

test("perpendicular hulls detect corner contact and a near miss", () => {
  const own = { x: 0, y: 0, heading: 0 };
  assert.equal(hullsOverlap(own, { x: 13, y: 13, heading: 90 }), true);
  assert.equal(hullsOverlap(own, { x: 13.001, y: 13, heading: 90 }), false);
  assert.equal(hullsOverlap(own, { x: 0, y: 0, heading: 90 }), true);
});

test("separation on the second boat axes rejects overlapping world bounds", () => {
  const own = { x: 0, y: 0, heading: 0 };
  const target = { x: 12, y: 19, heading: 45 };
  assert.equal(hullsOverlap(own, target), false);
  assert.equal(hullsOverlap(target, own), false);
});

test("rotated hulls use oriented footprints rather than axis-aligned bounds", () => {
  const own = { x: 200, y: -50, heading: 45 };
  const offset = 6.001 / Math.sqrt(2);
  const target = { x: own.x + offset, y: own.y - offset, heading: 45 };
  assert.equal(hullsOverlap(own, target), false);
  assert.equal(hullsOverlap(target, own), false);
  target.x = own.x + 5.9 / Math.sqrt(2);
  target.y = own.y - 5.9 / Math.sqrt(2);
  assert.equal(hullsOverlap(own, target), true);
});

test("default encounter latches first contact and cannot advance until reset", () => {
  let state = initialState();
  let previous = state;
  const command = { speed: 6, rudder: 0 };
  for (let i = 0; i < 4000 && !state.collision; i++) {
    previous = state;
    state = advance(state, command, STEP);
  }
  assert.ok(state.collision);
  assert.ok(state.collision.time > 92 && state.collision.time < 94);
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
  state.target = { ...state.target, x: state.own.x + 13, y: state.own.y, heading: 90 };
  const next = advance(state, { speed: 6, rudder: 0 }, STEP);
  assert.deepEqual(next.collision, { time: 0 });
  assert.equal(next.time, 0);
  assert.equal(next.own, state.own);
});

test("early starboard maneuver avoids the default collision", () => {
  let state = initialState();
  for (let i = 0; i < 3600; i++) state = advance(state, { speed: 6, rudder: 35 }, STEP);
  assert.equal(state.collision, null);
  assert.ok(state.time > 119);
});
