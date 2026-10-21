// Exact international definitions; simulation lengths remain metres internally.
export const METRES_PER_NM = 1852;
export const METRES_PER_YARD = 0.9144;
export const METRES_PER_FOOT = 0.3048;
export const KG_PER_LONG_TON = 1016.0469088;
export const yards = metres => metres / METRES_PER_YARD;
export const feet = metres => metres / METRES_PER_FOOT;
export const nauticalMiles = metres => metres / METRES_PER_NM;
export const longTons = tonnes => tonnes * 1000 / KG_PER_LONG_TON;
export const rangeText = metres => Math.abs(metres) < 200 * METRES_PER_YARD ? `${Math.round(yards(metres))} yd` : `${nauticalMiles(metres).toFixed(3)} NM`;
export const yardsText = metres => `${yards(metres).toFixed(1)} yd`;
export const bearingText = degrees => `${((Math.round(((degrees % 360 + 360) % 360) * 10) / 10) % 360).toFixed(1).padStart(5, "0")}°T`;
export const tcpaText = seconds => `${(seconds / 60).toFixed(2)} min`;
