/**
 * PROTOTYPE ONLY (no middleware yet)
 * Parse actor identity from query/body.
 * role: 'patient' | 'therapist'
 * actorId: string (MongoDB id or any external id)
 */
export function parseActor(req) {
  const role = (req.query.role || req.body.role || "").toString();
  const actorId = (req.query.actorId || req.body.actorId || "").toString();

  if (!role || !["patient", "therapist"].includes(role)) {
    return { ok: false, error: "role must be patient|therapist" };
  }
  if (!actorId.trim()) {
    return { ok: false, error: "actorId required" };
  }
  return { ok: true, role, actorId: actorId.trim() };
}
