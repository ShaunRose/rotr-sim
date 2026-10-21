/** Minimal surface used from the vendored Vessel.js v0.14 module. */
export class Ship {
  constructor(specification: object);
  structure: { hull: { calculateAttributesAtDraft(draft: number): { Vs: number; Awp: number; Cb: number } } };
}
