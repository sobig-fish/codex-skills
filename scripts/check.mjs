import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run(["scripts/check-publication.mjs"]);
for (const name of ["合约游戏案例测试", "工作区账号登录与团队展示案例"]) {
  const directory = path.join("cases", name, "tests");
  const tests = readdirSync(path.join(root, directory))
    .filter((file) => /\.test\.(?:mjs|ts|js)$/.test(file))
    .sort().map((file) => path.join(directory, file));
  if (!tests.length) throw new Error(`没有找到测试：${name}`);
  run(["--experimental-strip-types", "--test", ...tests]);
}
