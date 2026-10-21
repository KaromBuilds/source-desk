// Time is simulated: minutes since the pilot clock start (Mon 00:00).
export type Minutes = number;

export type SectorId = "S1" | "S2" | "S3" | "S4";

export interface Sector {
  id: SectorId;
  name: string;
  lat: number;
  lng: number;
  households: number; // count only, never locations
}

export interface Person {
  id: string;
  name: string; // invented
  role: string;
}

export interface Source {
  id: string;
  label: string;
  kind: "utility-bulletin" | "pressure-feed" | "community-route" | "provider-dispatch";
  method: string; // how it is verified
  ownerId: string;
  backupId: string | null;
  canConfirm: boolean; // may confirm official events
  verifiedAt: Minutes | null;
}

export interface UtilityAgreement {
  contactId: string | null;
  acceptedVerification: boolean;
  acceptedCorrections: boolean;
  acceptedEscalation: boolean;
  offlineRoute: string; // agreed non-smartphone route
  supervisorId: string | null;
}

export type IncidentStatus = "candidate" | "confirmed" | "dismissed" | "closed";
export type IncidentKind = "scheduled" | "unexpected";

export interface Incident {
  id: string;
  sector: SectorId;
  kind: IncidentKind;
  status: IncidentStatus;
  origin: "model" | "bulletin";
  modelScore: number | null;
  detectedAt: Minutes; // when the desk first knew
  utilityInputAt: Minutes | null; // when the utility gave its input
  startsAt: Minutes; // when the cut / failure starts
  confirmedBy: string | null; // person id
  confirmSourceId: string | null;
  cause: string | null; // only if sourced
  causeSource: string | null;
  restoration: Minutes | null; // only if sourced
  restorationSource: string | null;
  publishedAt: Minutes | null;
  nextUpdateDue: Minutes | null;
  lastUpdateAt: Minutes | null;
  dispatchAt: Minutes | null;
  receiptCheckAt: Minutes | null;
  escalationLevel: 0 | 1 | 2;
}

export interface Correction {
  id: string;
  incidentId: string | null;
  sector: SectorId;
  channel: "SMS" | "offline route";
  text: string;
  reportedAt: Minutes;
  dueAt: Minutes;
  ownerId: string;
  status: "open" | "accepted" | "rejected";
  resolvedAt: Minutes | null;
  resolution: string | null;
}

export interface LogEvent {
  at: Minutes;
  type: "gate" | "source" | "candidate" | "confirm" | "dismiss" | "publish" | "update" | "escalation" | "correction" | "rejected" | "spending" | "dispatch" | "receipt";
  incidentId?: string;
  text: string;
}

export interface DeskState {
  version: 1;
  now: Minutes;
  people: Person[];
  sources: Source[];
  agreement: UtilityAgreement;
  incidents: Incident[];
  corrections: Correction[];
  log: LogEvent[];
  spendingAuthorized: boolean;
  seenCandidates: string[]; // sector:index keys already turned into candidates
}
