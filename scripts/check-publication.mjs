import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const failures = [];
const forbiddenDirectories = new Set([".wrangler", ".openai", ".sites-runtime", ".vinext", ".next", "dist", "outputs", "node_modules", "data"]);
const allowedExtensions = new Set([".md", ".ts", ".mjs", ".js", ".json", ".sql", ".yml", ".yaml"]);
const patterns = [
  ["真实表格链接", /https?:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]+/],
  ["托管站点地址", /https?:\/\/[^\s<>"')]+\.chatgpt\.site\b/],
  ["部署标识", /\b(?:appgprj|appgver|appgdep)_[a-f0-9]{20,}/],
  ["本机账号路径", /\/Users\/[^\s/]+\//],
  ["GitHub 凭据", /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/],
  ["秘密材料", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["疑似服务端密钥", /\bsk-[A-Za-z0-9_-]{24,}\b/],
];
let count = 0;
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === ".git" && directory === root.replace(/\/$/, "")) continue;
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute);
    if (entry.isSymbolicLink()) { failures.push(`${relative}: 禁止符号链接`); continue; }
    if (entry.isDirectory()) {
      if (entry.name === ".git" || forbiddenDirectories.has(entry.name)) failures.push(`${relative}: 不应发布的目录`);
      else walk(absolute);
      continue;
    }
    if (![".gitignore", "LICENSE"].includes(entry.name) && !allowedExtensions.has(path.extname(entry.name))) {
      failures.push(`${relative}: 非白名单文件类型`); continue;
    }
    if (/^(?:\.env|\.dev\.vars)/.test(entry.name)) { failures.push(`${relative}: 环境文件`); continue; }
    const bytes = readFileSync(absolute);
    if (bytes.length > 300_000 || bytes.includes(0)) { failures.push(`${relative}: 大文件或二进制材料`); continue; }
    const text = bytes.toString("utf8");
    for (const [label, pattern] of patterns) if (pattern.test(text)) failures.push(`${relative}: ${label}`);
    const emails = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
    if (emails.some((email) => !/@example\.(?:test|com|org|net)$/i.test(email))) failures.push(`${relative}: 非示例邮箱`);
    count++;
  }
}
walk(root.replace(/\/$/, ""));
const fixturePath = path.join(root, "cases", "合约游戏案例测试", "fixtures", "synthetic-history.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
if (fixture.synthetic !== true || fixture.history?.length !== 38 || fixture.history.some((row, index) => {
  const total = (index * 7 + Math.floor(index / 5)) % 11;
  const date = new Date(Date.UTC(2026, 0, 5 + index * 7)).toISOString().slice(0, 10);
  return row.weekStart !== date || row.total !== total || row.monday !== Math.floor(total / 2) ||
    row.wednesday !== total - Math.floor(total / 2) || row.other !== 0 || row.confirmed !== true || row.source !== "synthetic-formula-v1";
})) failures.push("合成数据不符合公开生成公式");
if (failures.length) {
  console.error("发布检查失败（只显示文件和风险类型）：\n" + failures.join("\n"));
  process.exit(1);
}
console.log(`发布检查通过：${count} 个文本文件；未发现已配置的敏感模式；合约样本符合独立生成公式。仍须人工复核。`);
