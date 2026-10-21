import test from "node:test";
import assert from "node:assert/strict";
import { STEP } from "./model.mjs";
import { createSimulation, advanceSimulation, defaultSettings, observe, emitSignal, LOG_LIMIT } from "./watchkeeping.mjs";

const command = { speed: 6, rudder: 0 };
function run(state, seconds, settings, control = command) {
  for (let i = 0; i < Math.round(seconds / STEP); i++) state = advanceSimulation(state, control, STEP, settings);
  return state;
}
function disable(settings, id) {
  for (const device of Object.keys(settings.equipment[id])) settings.equipment[id][device] = false;
}

test("each ship starts with independent observations and no instantaneous radar velocity", () => {
  const state = createSimulation();
  assert.ok(state.bridge.own.visual.relative > 0);
  assert.ok(state.bridge.target.visual.relative < 0);
  assert.equal(state.bridge.own.track, null);
  assert.equal(state.bridge.target.track, null);
  assert.notEqual(state.bridge.own.logs, state.bridge.target.logs);
  assert.ok(state.bridge.own.logs.some(log => log.source === "CONTROL" && log.message.includes("Manual")));
  assert.ok(state.bridge.target.logs.some(log => log.source === "CONTROL" && log.message.includes("Scenario")));
});

test("repeated radar observations estimate motion without applying a rules policy", () => {
  const settings = defaultSettings();
  const state = run(createSimulation(settings), 12, settings);
  assert.ok(state.bridge.own.track);
  assert.ok(state.bridge.target.track);
  assert.equal(state.own.heading, 0);
  assert.equal(state.target.heading, 270);
  assert.equal(Object.hasOwn(state.bridge.own, "decision"), false);
});

test("AIS reports arrive after two seconds and preserve their broadcast timestamp", () => {
  const settings = defaultSettings();
  let state = run(createSimulation(settings), 1, settings);
  assert.equal(state.bridge.own.ais, null);
  state = run(state, 1, settings);
  assert.ok(state.bridge.own.ais);
  assert.equal(state.bridge.own.ais.sent, 0);
  assert.ok(state.bridge.own.logs.some(log => log.source === "AIS" && log.message.includes("2.0 s")));
});

test("AIS alone never creates visual contact or a radar track", () => {
  const settings = defaultSettings();
  settings.equipment.own.visual = false;
  settings.equipment.own.radar = false;
  const state = run(createSimulation(settings), 12, settings);
  assert.ok(state.bridge.own.ais);
  assert.equal(state.bridge.own.visual, null);
  assert.equal(state.bridge.own.track, null);
  assert.ok(state.bridge.target.track);
});

test("fog limits visual observations while retaining radar measurements", () => {
  const settings = defaultSettings();
  settings.visibility = 150; settings.restricted = true;
  const state = run(createSimulation(settings), 12, settings);
  for (const watch of [state.bridge.own, state.bridge.target]) {
    assert.equal(watch.visual, null);
    assert.ok(watch.track);
    assert.equal(Object.hasOwn(watch, "decision"), false);
  }
});

test("night lookout reports the appropriate opposite sidelights", () => {
  const settings = defaultSettings(); settings.night = true;
  const state = createSimulation(settings);
  assert.ok(state.bridge.own.visual.aspect.includes("red port"));
  assert.ok(state.bridge.target.visual.aspect.includes("green starboard"));
});

test("a blind receiver has no target observations despite evaluator access", () => {
  const settings = defaultSettings(); disable(settings, "own");
  const state = run(createSimulation(settings), 12, settings);
  assert.equal(state.bridge.own.visual, null);
  assert.equal(state.bridge.own.radar, null);
  assert.equal(state.bridge.own.ais, null);
  assert.ok(state.bridge.target.track);
});

test("configuration changes clear stale radar tracking and visual evidence immediately", () => {
  const settings = defaultSettings();
  let state = run(createSimulation(settings), 12, settings);
  settings.equipment.own.radar = false;
  settings.equipment.own.visual = false;
  state = { ...state, bridge: observe(state, state.bridge, settings, command) };
  assert.equal(state.bridge.own.track, null);
  assert.equal(state.bridge.own.visual, null);
  assert.ok(state.bridge.own.logs.some(log => log.source === "CONFIG"));
});

test("cached AIS expires after transmitter shutdown", () => {
  const settings = defaultSettings();
  let state = run(createSimulation(settings), 3, settings);
  assert.ok(state.bridge.own.ais);
  settings.equipment.target.ais = false;
  state = run(state, 16, settings);
  assert.equal(state.bridge.own.ais, null);
  assert.ok(state.bridge.own.logs.some(log => log.source === "AIS" && log.message.includes("expired")));
});

test("horn and radio requests are delivered to the other ship after propagation delay", () => {
  const settings = defaultSettings();
  let state = emitSignal(createSimulation(settings), settings, "own", "horn");
  state = emitSignal(state, settings, "own", "vhf");
  assert.equal(state.bridge.target.logs.some(log => log.source === "HEARING"), false);
  state = run(state, 2, settings);
  assert.ok(state.bridge.target.logs.some(log => log.source === "HEARING" && log.message.includes("No range")));
  assert.ok(state.bridge.target.logs.some(log => log.source === "VHF" && log.message.includes("No maneuver agreement")));
  assert.equal(state.bridge.own.logs.some(log => log.source === "HEARING"), false);
  assert.equal(state.bridge.signals.length, 0);
});

test("disabled receiving equipment does not receive horn or VHF messages", () => {
  const settings = defaultSettings();
  settings.equipment.target.hearing = false; settings.equipment.target.vhf = false;
  let state = emitSignal(createSimulation(settings), settings, "own", "horn");
  state = emitSignal(state, settings, "own", "vhf");
  state = run(state, 2, settings);
  assert.equal(state.bridge.target.logs.some(log => log.source === "HEARING" || log.source === "VHF"), false);
});

test("collision is recorded once in each evaluator log, and reset clears history", () => {
  const settings = defaultSettings();
  const state = run(createSimulation(settings), 100, settings);
  assert.ok(state.collision);
  for (const watch of [state.bridge.own, state.bridge.target]) assert.equal(watch.logs.filter(log => log.source === "EVALUATOR").length, 1);
  assert.equal(advanceSimulation(state, command, STEP, settings), state);
  const reset = createSimulation(settings);
  assert.equal(reset.bridge.own.logs.some(log => log.source === "EVALUATOR"), false);
  assert.equal(reset.bridge.signals.length, 0);
  assert.ok(reset.bridge.own.logs.every(log => log.time === 0));
});

test("deterministic observations and bounded histories survive a long run", () => {
  const settings = defaultSettings();
  const first = run(createSimulation(settings), 8, settings);
  const second = run(createSimulation(settings), 8, settings);
  assert.deepEqual(first.bridge, second.bridge);
  const state = run(createSimulation(settings), 400, settings, { speed: 6, rudder: 35 });
  assert.equal(state.collision, null);
  assert.equal(state.bridge.own.logs.length, LOG_LIMIT);
  assert.equal(state.bridge.target.logs.length, LOG_LIMIT);
});

test("bearing trends remain numeric observations when radar is disabled", () => {
  const settings = defaultSettings(); settings.equipment.own.radar = false;
  const state = run(createSimulation(settings), 12, settings);
  assert.equal(state.bridge.own.track, null);
  assert.ok(state.bridge.own.logs.some(log => log.source === "BEARING TREND"));
});

test("logs contain observations and actual commands, with no JavaScript rule decisions", () => {
  const settings = defaultSettings();
  const state = run(createSimulation(settings), 30, settings);
  for (const watch of [state.bridge.own, state.bridge.target]) {
    assert.equal(Object.hasOwn(watch, "decision"), false);
    assert.ok(watch.logs.every(log => ["sensor", "control", "system"].includes(log.kind)));
    assert.ok(watch.logs.every(log => !/Rules? \d|give.way|stand.on|recommend|risk presumed/i.test(log.message)));
    assert.ok(watch.logs.some(log => log.source === "BEARING TREND"));
    assert.ok(watch.logs.some(log => log.source === "CONTROL"));
  }
});
