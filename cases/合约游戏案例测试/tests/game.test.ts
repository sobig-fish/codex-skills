import test from "node:test";
import assert from "node:assert/strict";
import {
  buildForecast, categoryFor, categoryLabel, nextWeek, scheduleForWeek, stageFor, weekStartFor,
} from "../core/game.ts";
import type { HistoryWeek } from "../core/contracts.ts";

const ms = (value: string) => Date.parse(value);
const schedule = scheduleForWeek("2026-11-02");
const approvedRound = {
  ...schedule, approvedAt: schedule.reviewStartsAt, result: null, cancelledAt: null,
};
function historyWeek(weekStart: string, total: number, confirmed = true): HistoryWeek {
  return { weekStart, total, monday: total, wednesday: 0, other: 0, confirmed, source: "test" };
}
function series(start: string, totals: number[]): HistoryWeek[] {
  return totals.map((total, index) => historyWeek(nextWeek(start, index), total));
}

test("schedule is anchored to Shanghai target Monday and previous Wednesday/Thursday", () => {
  assert.deepEqual(schedule, {
    reviewStartsAt: ms("2026-10-28T11:00:00+08:00"),
    opensAt: ms("2026-10-28T12:30:00+08:00"),
    closesAt: ms("2026-10-29T18:00:00+08:00"),
    settlesAt: ms("2026-11-04T11:00:00+08:00"),
  });
});

test("week helpers cross years and use Shanghai instead of host or UTC dates", () => {
  assert.equal(weekStartFor(ms("2026-11-01T15:59:59.999Z")), "2026-10-26");
  assert.equal(weekStartFor(ms("2026-11-01T16:00:00Z")), "2026-11-02");
  assert.equal(weekStartFor(ms("2027-01-01T04:00:00+08:00")), "2026-12-28");
  assert.equal(nextWeek("2026-12-28"), "2027-01-04");
  assert.equal(nextWeek("2027-01-04", -1), "2026-12-28");
  assert.equal(scheduleForWeek("2027-01-04").reviewStartsAt, ms("2026-12-30T11:00:00+08:00"));
});

test("invalid week dates, invalid clocks and fractional offsets are rejected", () => {
  for (const date of ["2026-11-03", "2026-02-30", "11/02/2026", "invalid"]) {
    assert.throws(() => scheduleForWeek(date), RangeError);
  }
  assert.throws(() => weekStartFor(Number.NaN), RangeError);
  assert.throws(() => nextWeek("2026-11-02", 0.5), RangeError);
});

test("all phase boundaries are left-inclusive and right-exclusive", () => {
  assert.equal(stageFor(approvedRound, schedule.reviewStartsAt - 1), "upcoming");
  assert.equal(stageFor(approvedRound, schedule.reviewStartsAt), "review");
  assert.equal(stageFor(approvedRound, schedule.opensAt - 1), "review");
  assert.equal(stageFor(approvedRound, schedule.opensAt), "open");
  assert.equal(stageFor(approvedRound, schedule.closesAt - 1), "open");
  assert.equal(stageFor(approvedRound, schedule.closesAt), "closed");
  assert.equal(stageFor(approvedRound, schedule.settlesAt - 1), "closed");
  assert.equal(stageFor(approvedRound, schedule.settlesAt), "awaiting_result");
});

test("missing, late and out-of-window approval cannot open a round", () => {
  for (const approvedAt of [null, schedule.opensAt, schedule.opensAt + 1, schedule.reviewStartsAt - 1]) {
    const round = { ...approvedRound, approvedAt };
    assert.equal(stageFor(round, schedule.opensAt), "unpublished");
    assert.equal(stageFor(round, schedule.settlesAt), "unpublished");
  }
  assert.equal(stageFor({ ...approvedRound, approvedAt: schedule.opensAt - 1 }, schedule.opensAt), "open");
});

test("zero is a valid result and results do not reveal before the confirmation time", () => {
  const round = { ...approvedRound, result: 0 };
  assert.equal(stageFor(round, schedule.settlesAt - 1), "closed");
  assert.equal(stageFor(round, schedule.settlesAt), "settled");
  assert.equal(stageFor({ ...round, cancelledAt: schedule.settlesAt }, schedule.settlesAt), "cancelled");
});

test("current result confirmation and next review coexist as separate rounds", () => {
  const following = { ...scheduleForWeek("2026-11-09"), approvedAt: null, result: null, cancelledAt: null };
  assert.equal(following.reviewStartsAt, schedule.settlesAt);
  assert.equal(stageFor(approvedRound, schedule.settlesAt), "awaiting_result");
  assert.equal(stageFor(following, schedule.settlesAt), "review");
});

test("four categories are mutually exclusive, including zero and threshold boundaries", () => {
  assert.deepEqual([0, 1, 4, 5, 6].map((total) => categoryFor(total, 5)), ["zero", "below", "below", "equal", "above"]);
  assert.equal(categoryLabel("zero", 5), "0 人");
  assert.equal(categoryLabel("below", 5), "1–4 人");
  assert.equal(categoryLabel("equal", 5), "5 人");
  assert.equal(categoryLabel("above", 5), "≥ 6 人");
  assert.equal(categoryLabel("below", 2), "1 人");
  for (const threshold of [1, 2.5, Number.NaN]) assert.throws(() => categoryFor(0, threshold), RangeError);
  for (const total of [-1, 1.5, Number.NaN]) assert.throws(() => categoryFor(total, 5), RangeError);
});

test("target-week and future data cannot alter historical predictions or validation", () => {
  const historical = series("2026-07-06", Array.from({ length: 16 }, (_, index) => index % 7));
  const target = "2026-11-02";
  const baseline = buildForecast(historical, target, 5);
  const polluted = buildForecast([...historical, historyWeek(target, 9999), historyWeek("2026-11-09", 8888)], target, 5);
  const { warnings: _a, ...baselineValues } = baseline;
  const { warnings: _b, ...pollutedValues } = polluted;
  assert.deepEqual(pollutedValues, baselineValues);
  assert.ok(polluted.warnings.some((warning) => warning.includes("本期及之后")));
});

test("missing weeks remain missing rather than becoming zero observations", () => {
  const result = buildForecast([historyWeek("2026-10-05", 6), historyWeek("2026-10-19", 6)], "2026-11-02", 5);
  assert.equal(result.sampleSize, 2);
  assert.equal(result.mean, 6);
  assert.equal(result.low, 6);
  assert.equal(result.high, 6);
  assert.equal(result.probabilities.find((item) => item.category === "zero")?.probability, 0.125);
  assert.ok(result.warnings.some((warning) => warning.includes("缺少 1 周")));
  assert.ok(result.warnings.some((warning) => warning.includes("零入职周是否完整登记")));
});

test("unconfirmed observed registrations remain usable with a visible qualification", () => {
  const result = buildForecast([historyWeek("2026-10-19", 4, false)], "2026-11-02", 5);
  assert.equal(result.sampleSize, 1);
  assert.equal(result.mean, 4);
  assert.ok(result.warnings.some((warning) => warning.includes("未经最终入职确认")));
});

test("recorded zero totals are real observations and smoothed proportions sum to one", () => {
  const result = buildForecast(series("2026-09-28", [0, 1, 5, 6]), "2026-11-02", 5);
  assert.equal(result.sampleSize, 4);
  assert.equal(result.mean, 3);
  assert.deepEqual(result.probabilities.map((item) => item.probability), [0.25, 0.25, 0.25, 0.25]);
  assert.equal(result.probabilities.reduce((sum, item) => sum + item.probability, 0), 1);
});

test("empty history is explicitly unavailable, not a zero-person prediction", () => {
  const result = buildForecast([], "2026-11-02", 5);
  assert.equal(result.sampleSize, 0);
  assert.equal(result.backtestMae, null);
  assert.ok(result.method.includes("不是基于历史的预测"));
  assert.ok(result.warnings[0].includes("不能把占位数值 0 当作预测"));
});

test("reference selection adds historical seasonal weeks without double counting recent weeks", () => {
  const result = buildForecast([
    historyWeek("2025-10-27", 20),
    historyWeek("2025-06-02", 1000),
    ...series("2026-08-03", Array(12).fill(2)),
  ], "2026-11-02", 5);
  assert.equal(result.sampleSize, 13);
  assert.equal(result.mean, 3.38);
  assert.ok(result.method.includes("取并集"));
});

test("rolling holdout MAE trains strictly on earlier outcomes", () => {
  const result = buildForecast(series("2026-08-03", [0, 0, 0, 0, 0, 0, 0, 0, 0, 9, 9, 9]), "2026-11-02", 5);
  // The last week is unavailable at each review cutoff. Predictions are 0, 0,
  // and 0.9; held-out errors are 9, 9, and 8.1, with no future outcomes used.
  assert.equal(result.backtestMae, 8.7);
  assert.ok(result.method.includes("最近 3 个有记录周逐期留后验证"));
});

test("backtesting caps evaluation at the latest 12 observable weeks", () => {
  const result = buildForecast(series("2026-01-05", Array(30).fill(4)), "2026-11-02", 5);
  assert.equal(result.backtestMae, 0);
  assert.ok(result.method.includes("最近 12 个有记录周逐期留后验证"));
});

test("duplicates are not double counted and conflicting totals are excluded transparently", () => {
  const result = buildForecast([
    historyWeek("2026-10-12", 3, false), historyWeek("2026-10-12", 3, true),
    historyWeek("2026-10-19", 2), historyWeek("2026-10-19", 9),
    historyWeek("2026-10-05", 5),
  ], "2026-11-02", 5);
  assert.equal(result.sampleSize, 2);
  assert.equal(result.mean, 4);
  assert.ok(result.warnings.some((warning) => warning.includes("人数冲突的周已排除")));
  assert.ok(!result.warnings.some((warning) => warning.includes("未经最终入职确认")));
});

test("invalid historical rows are reported without contaminating the sample", () => {
  const result = buildForecast([
    historyWeek("2026-10-12", 3), historyWeek("2026-10-27", 7), historyWeek("2026-10-19", -2),
  ], "2026-11-02", 5);
  assert.equal(result.sampleSize, 1);
  assert.equal(result.mean, 3);
  assert.ok(result.warnings.some((warning) => warning.includes("2 条日期或人数无效")));
});

test("the last week confirming exactly at review opening cannot leak into the forecast", () => {
  const baseline = buildForecast([historyWeek("2026-10-19", 4)], "2026-11-02", 5);
  const withJustConfirmed = buildForecast([
    historyWeek("2026-10-19", 4), historyWeek("2026-10-26", 999, true),
  ], "2026-11-02", 5);
  assert.equal(withJustConfirmed.sampleSize, baseline.sampleSize);
  assert.equal(withJustConfirmed.mean, baseline.mean);
  assert.deepEqual(withJustConfirmed.probabilities, baseline.probabilities);
  assert.ok(withJustConfirmed.warnings.some((warning) => warning.includes("审核开始时才达到确认时间")));
  assert.ok(withJustConfirmed.warnings.some((warning) => warning.includes("没有逐条录入时间")));
});
