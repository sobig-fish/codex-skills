// This module does not perform SSO or validate bearer-token signatures.
// Only a server-configured adapter may supply already-verified identity claims.
const issuedIdentities = new WeakSet();
const roles = new Set(["admin", "member"]);

function boundedString(value, max = 200) {
  return typeof value === "string" && value.trim().length > 0 &&
    value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
}

/**
 * loadVerifiedClaims MUST verify a trusted session/token upstream, or read an
 * identity injected by an enforced trusted gateway. It must never simply return
 * request.body or untrusted request headers. This constructor is server wiring,
 * not an API route accepting a caller-controlled "verified" flag.
 */
export function createVerifiedIdentityResolver({ issuer, audience, loadVerifiedClaims } = {}) {
  if (!boundedString(issuer) || !boundedString(audience) || typeof loadVerifiedClaims !== "function") {
    throw new TypeError("A trusted server-side identity adapter, issuer and audience are required.");
  }
  return async function resolveIdentity(requestContext) {
    const claims = await loadVerifiedClaims(requestContext);
    if (!claims || typeof claims !== "object" || claims.issuer !== issuer || claims.audience !== audience ||
        !boundedString(claims.subject) || !boundedString(claims.email, 254)) return null;
    const email = claims.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) return null;
    const identity = Object.freeze({
      subject: claims.subject,
      email,
      displayName: boundedString(claims.displayName) ? claims.displayName.trim() : email,
    });
    issuedIdentities.add(identity);
    return identity;
  };
}

function denied(status, reason) { return { allowed: false, status, reason }; }

/** Consult the current server-owned membership list for every operation. */
export function authorize(identity, members, action, resourceOwnerSubject = null) {
  if (!identity || typeof identity !== "object" || !issuedIdentities.has(identity)) {
    return denied(401, "verified_identity_required");
  }
  if (!Array.isArray(members)) return denied(403, "membership_unavailable");
  const matches = members.filter((member) => member.subject === identity.subject);
  if (matches.length !== 1) return denied(403, "membership_missing_or_ambiguous");
  const member = matches[0];
  if (member.active !== true || !roles.has(member.role)) return denied(403, "membership_inactive_or_invalid");
  const allowed = action === "view_directory" ||
    (action === "edit_intro" && boundedString(resourceOwnerSubject) &&
      (resourceOwnerSubject === identity.subject || member.role === "admin")) ||
    (action === "manage_members" && member.role === "admin");
  return allowed ? { allowed: true, status: 200, actor: { subject: identity.subject, role: member.role } }
    : denied(403, "operation_not_allowed");
}

/** Return display fields only; exclude inactive/ambiguous owners and auth data. */
export function directoryFor(identity, members, profiles, { query = "", team = "" } = {}) {
  const access = authorize(identity, members, "view_directory");
  if (!access.allowed) return { ...access, cards: [] };
  const search = String(query).trim().toLocaleLowerCase();
  const teamFilter = String(team).trim();
  const cards = profiles.filter((profile) => {
    const owners = members.filter((member) => member.subject === profile.ownerSubject);
    return owners.length === 1 && owners[0].active === true && roles.has(owners[0].role) &&
      (!teamFilter || profile.team === teamFilter) &&
      (!search || [profile.name, profile.team, profile.city, profile.intro].join(" ").toLocaleLowerCase().includes(search));
  }).map(({ id, name, team: group, city, intro }) => ({ id, name, team: group, city, intro }));
  return { allowed: true, status: 200, cards };
}
