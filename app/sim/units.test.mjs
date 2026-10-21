import test from "node:test";
import assert from "node:assert/strict";
import { feet, yards, nauticalMiles, longTons, rangeText, bearingText, tcpaText } from "./units.mjs";
test("naval unit conversions use exact definitions", () => {
 assert.equal(feet(0.3048),1); assert.equal(yards(0.9144),1); assert.equal(nauticalMiles(1852),1);
 assert.ok(Math.abs(longTons(1.0160469088)-1)<1e-12);
});
test("range uses yards inside 200 yards and nautical miles beyond", () => {
 assert.equal(rangeText(0),"0 yd"); assert.equal(rangeText(150),"164 yd");
 assert.equal(rangeText(182.88),"0.099 NM"); assert.equal(rangeText(1852),"1.000 NM");
});
test("true bearings wrap after rounding and TCPA uses minutes", () => {
 assert.equal(bearingText(0),"000.0°T"); assert.equal(bearingText(359.99),"000.0°T");
 assert.equal(bearingText(-90),"270.0°T"); assert.equal(tcpaText(90),"1.50 min");
});
