import { authorize, createVerifiedIdentityResolver, directoryFor } from "./policy.mjs";
import { fixtureAudience, fixtureClaims, fixtureIssuer, members, profiles } from "./team.mjs";

console.log("本地合成身份演示，不是真实 ChatGPT 登录；不联网、不启动服务、不修改数据。\n");

// Fixture-only adapter. NEVER deploy this as an authentication implementation.
async function syntheticIdentity(subject, email) {
  const resolveIdentity = createVerifiedIdentityResolver({
    issuer: fixtureIssuer,
    audience: fixtureAudience,
    loadVerifiedClaims: async () => fixtureClaims(subject, email),
  });
  return resolveIdentity();
}

const member = await syntheticIdentity("fixture-member-a", "member-a@example.test");
const admin = await syntheticIdentity("fixture-admin", "organizer@example.test");
const guest = await syntheticIdentity("fixture-outsider", "outsider@example.test");

console.log(JSON.stringify({
  notice: "身份来自合成测试适配器；实际部署必须替换为可信身份验证结果。",
  memberDirectory: directoryFor(member, members, profiles, { team: "支持组" }),
  memberManagement: authorize(member, members, "manage_members"),
  adminManagement: authorize(admin, members, "manage_members"),
  outsiderDirectory: directoryFor(guest, members, profiles),
  forgedIdentity: authorize({ subject: "fixture-admin", verified: true }, members, "manage_members"),
}, null, 2));
