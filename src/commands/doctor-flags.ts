// Kept apart from doctor.ts so the CLI can declare `relay doctor`'s options
// without loading the doctor command (and the adapter registry it imports).
export const DOCTOR_STRICT_FLAG = "--strict";
