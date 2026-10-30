import test from "node:test";
import assert from "node:assert/strict";
import { authorize, createVerifiedIdentityResolver, directoryFor } from "../example/policy.mjs";
import { fixtureAudience, fixtureClaims, fixtureIssuer, members, profiles } from "../example/team.mjs";

function resolver(claims) {
  return createVerifiedIdentityResolver({ issuer: fixtureIssuer, audience: fixtureAudience, loadVerifiedClaims: async () => claims });
}
async function identity(subject = "fixture-member-a", email = "member-a@example.test") {
  return resolver(fixtureClaims(subject, email))();
}

test("no default identity adapter exists", () => {
  assert.throws(() => createVerifiedIdentityResolver(), TypeError);
  assert.throws(() => createVerifiedIdentityResolver({ issuer: fixtureIssuer, audience: fixtureAudience, loadVerifiedClaims: true }), TypeError);
});

test("raw public headers and a verified=true field never establish identity", () => {
  assert.equal(authorize({ "oai-authenticated-user-id": "fixture-admin", "oai-authenticated-user-email": "organizer@example.test" }, members, "manage_members").status, 401);
  assert.equal(authorize({ subject: "fixture-admin", verified: true }, members, "manage_members").status, 401);
  assert.equal(authorize(null, members, "view_directory").status, 401);
});

test("only the configured adapter result is accepted, with matching issuer and audience", async () => {
  const valid = fixtureClaims("fixture-member-a", "member-a@example.test");
  assert.equal(await resolver(null)(), null);
  assert.equal(await resolver({ ...valid, issuer: "another-issuer" })(), null);
  assert.equal(await resolver({ ...valid, audience: "another-site" })(), null);
  const result = await resolver(valid)();
  assert.equal(authorize(result, members, "view_directory").allowed, true);
});

test("invalid claims are rejected rather than repaired into an identity", async () => {
  const valid = fixtureClaims("fixture-member-a", "member-a@example.test");
  for (const invalid of [{ ...valid, subject: "" }, { ...valid, subject: "bad\nidentity" }, { ...valid, email: "not-an-email" }, { ...valid, email: "member-a@example.test\r\nadmin" }]) {
    assert.equal(await resolver(invalid)(), null);
  }
});

test("identity is immutable; copied objects do not retain trusted provenance", async () => {
  const result = await identity();
  assert.equal(Object.isFrozen(result), true);
  assert.throws(() => { result.subject = "fixture-admin"; }, TypeError);
  assert.equal(authorize({ ...result }, members, "view_directory").status, 401);
});

test("display names are optional and email normalization does not grant membership", async () => {
  const result = await resolver({ ...fixtureClaims("fixture-outsider", " OUTSIDER@EXAMPLE.TEST "), displayName: "" })();
  assert.equal(result.email, "outsider@example.test");
  assert.equal(result.displayName, "outsider@example.test");
  assert.equal(authorize(result, members, "view_directory").status, 403);
});

test("matching email or email suffix cannot take over a different user ID", async () => {
  const outsider = await identity("fixture-outsider", "organizer@example.test");
  assert.equal(authorize(outsider, members, "manage_members").status, 403);
  assert.equal(authorize(outsider, members, "view_directory").status, 403);
});

test("roles come from server membership, not adapter claims", async () => {
  const result = await resolver({ ...fixtureClaims("fixture-member-a", "member-a@example.test"), role: "admin" })();
  assert.equal(authorize(result, members, "view_directory").allowed, true);
  assert.equal(authorize(result, members, "manage_members").status, 403);
  assert.equal(authorize(result, members, "edit_intro", "fixture-member-a").allowed, true);
  assert.equal(authorize(result, members, "edit_intro", "fixture-member-b").status, 403);
});

test("an explicitly configured administrator can manage members and edit another intro", async () => {
  const result = await identity("fixture-admin", "organizer@example.test");
  assert.equal(authorize(result, members, "manage_members").allowed, true);
  assert.equal(authorize(result, members, "edit_intro", "fixture-member-a").allowed, true);
});

test("member deactivation takes effect on the next operation with the same identity", async () => {
  const result = await identity();
  const currentMembers = structuredClone(members);
  assert.equal(authorize(result, currentMembers, "view_directory").allowed, true);
  currentMembers.find((member) => member.subject === result.subject).active = false;
  assert.equal(authorize(result, currentMembers, "view_directory").status, 403);
  assert.equal(authorize(result, currentMembers, "edit_intro", result.subject).status, 403);
});

test("missing or ambiguous membership, invalid role and unknown actions fail closed", async () => {
  const result = await identity();
  assert.equal(authorize(result, null, "view_directory").status, 403);
  assert.equal(authorize(result, [...members, members[1]], "view_directory").status, 403);
  assert.equal(authorize(result, [{ ...members[1], role: "superuser" }], "view_directory").status, 403);
  assert.equal(authorize(result, members, "delete_everything").status, 403);
});

test("directory search and team filter compose without exposing auth or inactive records", async () => {
  const result = directoryFor(await identity(), members, profiles, { team: "支持组", query: "操作说明" });
  assert.equal(result.allowed, true);
  assert.equal(result.cards.length, 1);
  assert.equal(result.cards[0].id, "profile-sprout");
  assert.deepEqual(Object.keys(result.cards[0]).sort(), ["city", "id", "intro", "name", "team"]);
  const all = directoryFor(await identity(), members, profiles);
  assert.equal(all.cards.length, 3);
  assert.ok(!JSON.stringify(all).includes("example.test"));
  assert.ok(!JSON.stringify(all).includes("fixture-"));
});

test("unauthorized directory requests receive no cards", async () => {
  const outsider = await identity("fixture-outsider", "outsider@example.test");
  assert.deepEqual(directoryFor(outsider, members, profiles).cards, []);
  assert.deepEqual(directoryFor(null, members, profiles).cards, []);
});

test("the email is not the permanent authorization key after a trusted identity change", async () => {
  const sameUser = await identity("fixture-member-a", "updated-address@example.test");
  assert.equal(authorize(sameUser, members, "view_directory").allowed, true);
});
