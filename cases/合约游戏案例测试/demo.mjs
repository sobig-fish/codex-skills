import { readFile } from "node:fs/promises";
import { buildForecast, categoryLabel, scheduleForWeek, stageFor } from "./core/game.ts";
import { simulationMultiplier } from "./core/simulation.ts";

const fixture = JSON.parse(await readFile(new URL("./fixtures/synthetic-history.json", import.meta.url), "utf8"));
if (fixture.synthetic !== true) throw new Error("演示只接受标为 synthetic 的虚构数据。");
const week = "2026-11-02";
const threshold = 5;
const schedule = scheduleForWeek(week);
const forecast = buildForecast(fixture.history, week, threshold);
const round = { ...schedule, approvedAt: schedule.reviewStartsAt, result: null, cancelledAt: null };
console.log("合约游戏案例测试｜全部为公式生成的虚构数据；无购买、奖励或兑换。");
console.log("这是本地算法演示，没有连接表格、身份服务或数据库。");
console.table(Object.entries(schedule).map(([phase, value]) => ({ phase, shanghaiTime: new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) })));
console.table(forecast.probabilities.map(({ category, probability }) => {
  const multiplier = simulationMultiplier(probability, forecast.sampleSize);
  return {
  option: categoryLabel(category, threshold),
  reference: `${(probability * 100).toFixed(1)}%`,
  simulatedMultiplier: multiplier === null ? "暂无参考" : multiplier.toFixed(2) + "×",
  };
}));
console.log("开场状态：", stageFor(round, schedule.opensAt));
console.log("确认时间到达、尚无结果：", stageFor(round, schedule.settlesAt));
console.log("管理员确认虚构结果为 0：", stageFor({ ...round, result: 0 }, schedule.settlesAt));
console.log("模型说明：", forecast.method);
console.log("局限：", forecast.warnings.join("\n"));
