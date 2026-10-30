// Entirely fictional fixtures. These identifiers are not platform account IDs.
export const members = [
  { subject: "fixture-admin", email: "organizer@example.test", role: "admin", active: true },
  { subject: "fixture-member-a", email: "member-a@example.test", role: "member", active: true },
  { subject: "fixture-member-b", email: "member-b@example.test", role: "member", active: true },
  { subject: "fixture-inactive", email: "inactive@example.test", role: "member", active: false },
];

export const profiles = [
  { id: "profile-orbit", ownerSubject: "fixture-admin", name: "示例成员·小轨", team: "协作组", city: "示例城市甲", intro: "负责组织团队分享，喜欢把经验整理成清单。" },
  { id: "profile-cloud", ownerSubject: "fixture-member-a", name: "示例成员·小云", team: "支持组", city: "示例城市乙", intro: "关注常见问题的排查和知识复用。" },
  { id: "profile-sprout", ownerSubject: "fixture-member-b", name: "示例成员·小芽", team: "支持组", city: "示例城市甲", intro: "喜欢制作易懂的操作说明。" },
  { id: "profile-inactive", ownerSubject: "fixture-inactive", name: "已停用示例成员", team: "协作组", city: "示例城市丙", intro: "此资料不应出现在目录响应中。" },
];

export const fixtureIssuer = "local-fixture-not-chatgpt";
export const fixtureAudience = "synthetic-team-demo";
export function fixtureClaims(subject, email) {
  return { issuer: fixtureIssuer, audience: fixtureAudience, subject, email, displayName: "本地合成身份" };
}
