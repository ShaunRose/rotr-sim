import test from "node:test";
import assert from "node:assert/strict";
import { STEP } from "./model.mjs";
import { createSimulation, advanceSimulation, defaultSettings, observe, emitSignal } from "./watchkeeping.mjs";
import { sensorFrame as projectFrame, sensorPresentation as projectPresentation, defaultOverlays } from "./sensor-view.mjs";
const allEnabled = Object.fromEntries(Object.keys(defaultOverlays).map(key => [key, true]));
const sensorFrame = (watch, settings, time, enabled = allEnabled) => projectFrame(watch, settings, time, enabled);
const sensorPresentation = (state, view, enabled = allEnabled) => projectPresentation(state, view, enabled);
test("all overlays start disabled without disabling detection equipment", () => {
  const state = createSimulation();
  const frame = projectPresentation(state, "own").frames[0];
  assert.ok(Object.values(defaultOverlays).every(value => value === false));
  assert.equal(frame.visual, null); assert.equal(frame.radar, null);
  assert.equal(frame.visibility, null); assert.equal(frame.radarEnabled, false);
  assert.ok(state.bridge.own.visual); assert.ok(state.bridge.own.radar);
});
const command = { speed: 6, rudder: 0 };
function run(state, seconds, settings) {
  for (let i = 0; i < Math.round(seconds / STEP); i++) state = advanceSimulation(state, command, STEP, settings);
  return state;
}

test("receiver views draw only the selected live hull; observer mode includes both", () => {
  const state = createSimulation();
  assert.deepEqual(sensorPresentation(state, "own").physicalShips, ["own"]);
  assert.deepEqual(sensorPresentation(state, "target").physicalShips, ["target"]);
  assert.deepEqual(sensorPresentation(state, "observer").physicalShips, ["own", "target"]);
  assert.equal(sensorPresentation(state, "own").frames.length, 1);
});

test("an old radar marker stays at the scan location when the observer moves", () => {
  const settings = defaultSettings();
  const initial = createSimulation(settings);
  const before = sensorFrame(initial.bridge.own, settings, 0).radar.point;
  const moved = run(initial, 1, settings);
  const after = sensorFrame(moved.bridge.own, settings, moved.time).radar.point;
  assert.notEqual(moved.own.y, initial.own.y);
  assert.deepEqual(after, before);
});

test("AIS marker uses the delayed broadcast location, not the current vessel", () => {
  const settings = defaultSettings();
  const state = run(createSimulation(settings), 3, settings);
  const frame = sensorPresentation(state, "own").frames[0];
  assert.equal(frame.ais.point.x, 660);
  assert.ok(state.target.x < frame.ais.point.x);
  assert.ok(frame.ais.age > 2.9);
});

test("other-ship truth changes cannot change a receiver presentation without observations", () => {
  const state = createSimulation();
  const before = sensorPresentation(state, "own");
  const altered = { ...state, target: { ...state.target, x: -99999, y: 99999, heading: 12 } };
  assert.deepEqual(sensorPresentation(altered, "own"), before);
});

test("fog and disabled receivers remove markers and cannot reveal an unknown target", () => {
  const settings = defaultSettings(); settings.visibility = 150; settings.restricted = true;
  for (const device of Object.keys(settings.equipment.own)) settings.equipment.own[device] = false;
  const frame = sensorPresentation(createSimulation(settings), "own").frames[0];
  assert.equal(frame.visual, null);
  assert.equal(frame.radar, null);
  assert.equal(frame.prediction, null);
  assert.equal(frame.ais, null);
  assert.equal(frame.knownTarget, null);
});

test("radar-only fog contact yields an echo but never a visual contact marker", () => {
  const settings = defaultSettings(); settings.visibility = 150; settings.restricted = true;
  const state = run(createSimulation(settings), 6, settings);
  const frame = sensorPresentation(state, "target").frames[0];
  assert.equal(frame.visual, null);
  assert.equal(frame.visibility, 150);
  assert.ok(frame.radar);
  assert.ok(frame.prediction);
  assert.deepEqual(sensorPresentation(state, "target").physicalShips, ["target"]);
});

test("each display toggle hides its layer without changing receiver observations", () => {
  const settings = defaultSettings(); const state = run(createSimulation(settings), 6, settings);
  const enabled = Object.fromEntries(Object.keys(defaultOverlays).map(key => [key, false]));
  const frame = sensorPresentation(state, "own", enabled).frames[0];
  assert.equal(frame.visual, null); assert.equal(frame.radar, null); assert.equal(frame.prediction, null); assert.equal(frame.ais, null);
  assert.equal(frame.radarEnabled, false); assert.equal(frame.visibility, null);
  assert.ok(state.bridge.own.radar); assert.ok(state.bridge.own.ais);
});

test("stale samples and reports disappear rather than being shown as current contacts", () => {
  const settings = defaultSettings(); const state = run(createSimulation(settings), 6, settings);
  const frame = sensorFrame(state.bridge.own, settings, 30);
  assert.equal(frame.visual, null); assert.equal(frame.radar, null); assert.equal(frame.ais, null); assert.equal(frame.prediction, null);
});

test("received horn overlays contain direction only, never emitter position or identity", () => {
  const settings = defaultSettings();
  let state = emitSignal(createSimulation(settings), settings, "own", "horn");
  assert.equal(sensorPresentation(state, "target").emissions.length, 0);
  assert.equal(sensorPresentation(state, "observer").emissions.length, 1);
  assert.equal(sensorPresentation(state, "target").frames[0].hearing.length, 0);
  state = run(state, 2, settings);
  const heard = sensorPresentation(state, "target").frames[0].hearing[0];
  assert.ok(heard); assert.equal(heard.from, null);
  assert.equal(Object.hasOwn(heard, "originX"), false);
  assert.equal(Object.hasOwn(heard, "range"), false);
  assert.ok(Number.isFinite(heard.bearing));
});

test("VHF receiver label appears after reception and signal overlays expire on simulation time", () => {
  const settings = defaultSettings();
  let state = emitSignal(createSimulation(settings), settings, "own", "vhf");
  assert.equal(sensorPresentation(state, "target").frames[0].vhf.length, 0);
  state = run(state, 2, settings);
  const message = sensorPresentation(state, "target").frames[0].vhf[0];
  assert.equal(message.message, "Please state your intentions.");
  assert.equal(message.bearing, null);
  state = run(state, 9, settings);
  assert.equal(sensorPresentation(state, "target").frames[0].vhf.length, 0);
  assert.equal(state.bridge.emissions.length, 0);
});

test("disabling receiving equipment suppresses received overlays immediately", () => {
  const settings = defaultSettings();
  let state = emitSignal(createSimulation(settings), settings, "own", "horn");
  state = run(state, 2, settings);
  assert.equal(sensorPresentation(state, "target").frames[0].hearing.length, 1);
  settings.equipment.target.hearing = false;
  state = { ...state, bridge: observe(state, state.bridge, settings, command) };
  assert.equal(sensorPresentation(state, "target").frames[0].hearing.length, 0);
});

test("predicted vectors use estimated motion and a reset clears overlays and transmissions", () => {
  const settings = defaultSettings(); const state = run(createSimulation(settings), 6, settings);
  const frame = sensorPresentation(state, "own").frames[0];
  assert.ok(frame.prediction);
  assert.ok(Number.isFinite(frame.prediction.vectorEnd.x));
  const reset = sensorPresentation(createSimulation(settings), "own");
  assert.equal(reset.frames[0].ais, null); assert.equal(reset.frames[0].prediction, null);
  assert.equal(reset.frames[0].hearing.length, 0); assert.equal(reset.frames[0].vhf.length, 0);
});
