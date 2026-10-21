import type { DeskState, Sector } from "./types.ts";

// FICTIONAL pilot. Every name, sector and number here is invented for the demo.
export const SECTORS: Sector[] = [
  { id: "S1", name: "Sector 1 (fictional)", lat: 19.3615, lng: -99.0745, households: 25 },
  { id: "S2", name: "Sector 2 (fictional)", lat: 19.3622, lng: -99.0565, households: 25 },
  { id: "S3", name: "Sector 3 (fictional)", lat: 19.3478, lng: -99.0738, households: 25 },
  { id: "S4", name: "Sector 4 (fictional)", lat: 19.3485, lng: -99.0572, households: 25 },
];

export function demoState(): DeskState {
  return {
    version: 1,
    now: 8 * 60, // Mon 08:00
    people: [
      { id: "p1", name: "Lic. Teresa Ruiz", role: "Utility operations desk" },
      { id: "p2", name: "Ing. Marco Salas", role: "Utility network engineer" },
      { id: "p3", name: "Ing. Laura Quintero", role: "Utility shift supervisor" },
      { id: "p4", name: "Doña Lupita Ramos", role: "Community contact" },
      { id: "p5", name: "Joel Bautista", role: "Community contact (backup)" },
      { id: "p6", name: "Pipas Oriente dispatch", role: "Water truck provider" },
      { id: "p7", name: "Ana Cortés", role: "Pilot coordinator" },
    ],
    sources: [
      { id: "src1", label: "Mesa de Operación (utility bulletin)", kind: "utility-bulletin", method: "Official cut schedule, confirmed by phone with the ops desk", ownerId: "p1", backupId: null, canConfirm: true, verifiedAt: null },
      { id: "src2", label: "Sector pressure loggers (SIMULATED feed)", kind: "pressure-feed", method: "Model flags candidates only; engineer checks the logger", ownerId: "p2", backupId: "p3", canConfirm: false, verifiedAt: null },
      { id: "src3", label: "Community route (calls / door-to-door)", kind: "community-route", method: "Two contacts per sector; reports logged with time", ownerId: "p4", backupId: "p5", canConfirm: false, verifiedAt: null },
      { id: "src4", label: "Water truck dispatch", kind: "provider-dispatch", method: "Dispatch time and receipt check by community contact", ownerId: "p6", backupId: "p7", canConfirm: false, verifiedAt: null },
    ],
    agreement: {
      contactId: "p1",
      acceptedVerification: true,
      acceptedCorrections: false,
      acceptedEscalation: false,
      offlineRoute: "",
      supervisorId: null,
    },
    incidents: [],
    corrections: [],
    log: [{ at: 8 * 60, type: "gate", text: "Pilot created. LOCKED until the utility contact accepts all duties." }],
    spendingAuthorized: false,
    seenCandidates: [],
  };
}
