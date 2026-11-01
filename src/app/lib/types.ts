// ─── Shared domain types ───────────────────────────────────────────────────────
// Centralised here so ActionPanels (client) and dashboard/page (server)
// can both import without circular dependencies.

export type StaffMember = {
  staff_id:     number;
  staff_code:   string;   // e.g. '01', '02', '11' — used as display identifier
  first_name:   string;
  last_name:    string;
  medical_role: string;
};

export type OperatingTheater = {
  ot_id:        number;
  room_number:  string;
  ot_specialty: string;
};

