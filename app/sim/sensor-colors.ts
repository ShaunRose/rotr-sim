/** Shared colors for sensor geometry, controls, legends, and terminal output. */
export const sensorColors = {
  visual: "#74e39a", radar: "#56d9f5", arpa: "#bc9cff", ais: "#f5dc70",
  sound: "#ffac66", vhf: "#ff8fc8", navigation: "#8eb8ff",
};
export const sensorNames = { visual: "Lookout", radar: "RADAR", arpa: "ARPA", ais: "AIS", sound: "Sound", vhf: "VHF", navigation: "GNSS / gyro / log" };
export function logColor(source: string) {
  if (source === "LOOKOUT" || source === "BEARING TREND") return sensorColors.visual;
  if (source === "RADAR") return sensorColors.radar;
  if (source === "ARPA") return sensorColors.arpa;
  if (source === "AIS") return sensorColors.ais;
  if (source === "HEARING" || source === "HORN TX") return sensorColors.sound;
  if (source === "VHF" || source === "VHF TX") return sensorColors.vhf;
  if (source === "GNSS / GYRO / LOG") return sensorColors.navigation;
  return undefined;
}
