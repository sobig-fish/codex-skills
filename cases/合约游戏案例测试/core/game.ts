import type { Category, Forecast, HistoryWeek, Round, Stage } from "./contracts.ts";

const DAY = 86_400_000;
const WEEK = 7 * DAY;
const SHANGHAI_OFFSET = 8 * 60 * 60 * 1_000;
const CATEGORIES: Category[] = ["zero", "below", "equal", "above"];

function localDate(dateMs: number): string {
  if (!Number.isFinite(dateMs)) throw new RangeError("时间必须是有效的毫秒时间戳");
  return new Date(dateMs + SHANGHAI_OFFSET).toISOString().slice(0, 10);
}

function mondayMs(weekStart: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    throw new RangeError("期次必须使用 YYYY-MM-DD 格式的周一日期");
  }
  const value = Date.parse(`${weekStart}T00:00:00+08:00`);
  if (!Number.isFinite(value) || localDate(value) !== weekStart ||
      new Date(value + SHANGHAI_OFFSET).getUTCDay() !== 1) {
    throw new RangeError("期次必须是有效的周一日期");
  }
  return value;
}

function checkThreshold(threshold: number): void {
  if (!Number.isInteger(threshold) || threshold < 2) {
    throw new RangeError("分组阈值必须为至少 2 的整数");
  }
}

/** The date identifies the Monday of the week whose onboarding total is predicted. */
export function scheduleForWeek(weekStart: string): {
  reviewStartsAt: number; opensAt: number; closesAt: number; settlesAt: number;
} {
  const monday = mondayMs(weekStart);
  return {
    reviewStartsAt: monday - 5 * DAY + 11 * 3_600_000,
    opensAt: monday - 5 * DAY + 12.5 * 3_600_000,
    closesAt: monday - 4 * DAY + 18 * 3_600_000,
    settlesAt: monday + 2 * DAY + 11 * 3_600_000,
  };
}

export function weekStartFor(dateMs: number): string {
  const date = localDate(dateMs);
  const midnight = Date.parse(`${date}T00:00:00+08:00`);
  const day = new Date(midnight + SHANGHAI_OFFSET).getUTCDay();
  return localDate(midnight - ((day + 6) % 7) * DAY);
}

export function nextWeek(weekStart: string, delta = 1): string {
  if (!Number.isInteger(delta)) throw new RangeError("周数偏移必须是整数");
  const value = localDate(mondayMs(weekStart) + delta * WEEK);
  mondayMs(value);
  return value;
}

type TimedRound = Pick<Round,
  "reviewStartsAt" | "opensAt" | "closesAt" | "settlesAt" |
  "approvedAt" | "result" | "cancelledAt">;

/** This is a display state; every write still needs atomic server-side checks. */
export function stageFor(round: TimedRound, now: number): Stage {
  if (!Number.isFinite(now)) throw new RangeError("当前时间无效");
  if (round.cancelledAt !== null) return "cancelled";
  if (now < round.reviewStartsAt) return "upcoming";
  if (now < round.opensAt) return "review";
  const validApproval = round.approvedAt !== null &&
    round.approvedAt >= round.reviewStartsAt && round.approvedAt < round.opensAt;
  if (!validApproval) return "unpublished";
  if (now < round.closesAt) return "open";
  if (now < round.settlesAt) return "closed";
  return round.result === null ? "awaiting_result" : "settled";
}

export function categoryFor(total: number, threshold: number): Category {
  checkThreshold(threshold);
  if (!Number.isInteger(total) || total < 0) throw new RangeError("人数必须是非负整数");
  if (total === 0) return "zero";
  if (total < threshold) return "below";
  return total === threshold ? "equal" : "above";
}

export function categoryLabel(category: Category, threshold: number): string {
  checkThreshold(threshold);
  const labels: Record<Category, string> = {
    zero: "0 人",
    below: threshold === 2 ? "1 人" : `1–${threshold - 1} 人`,
    equal: `${threshold} 人`,
    above: `≥ ${threshold + 1} 人`,
  };
  return labels[category];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function quantile(sorted: number[], fraction: number): number {
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[Math.ceil(index)] * weight;
}

// A shared leap year gives month/day proximity without ISO-week or year-end jumps.
function seasonalDay(weekStart: string): number {
  return Date.parse(`2000-${weekStart.slice(5)}T00:00:00Z`) / DAY;
}

function referenceWeeks(past: HistoryWeek[], targetWeek: string): HistoryWeek[] {
  const reviewCutoff = scheduleForWeek(targetWeek).reviewStartsAt;
  // Last week's confirmation falls exactly at this review's opening. Without
  // observed-at timestamps, exclude it conservatively rather than assume it was
  // available before review began. Apply the same lead time during backtesting.
  const eligible = past.filter((week) =>
    scheduleForWeek(week.weekStart).settlesAt < reviewCutoff);
  const recent = new Set(eligible.slice(-12).map((week) => week.weekStart));
  const targetDay = seasonalDay(targetWeek);
  const targetYear = targetWeek.slice(0, 4);
  return eligible.filter((week) => {
    if (recent.has(week.weekStart)) return true;
    if (week.weekStart.slice(0, 4) >= targetYear) return false;
    const distance = Math.abs(seasonalDay(week.weekStart) - targetDay);
    return Math.min(distance, 366 - distance) <= 28;
  });
}

/** Descriptive historical reference only: no prices, odds, stakes, or redemption. */
export function buildForecast(
  history: HistoryWeek[], targetWeek: string, threshold: number,
): Forecast {
  const target = mondayMs(targetWeek);
  const reviewCutoff = scheduleForWeek(targetWeek).reviewStartsAt;
  checkThreshold(threshold);
  const warnings: string[] = [];
  const unique = new Map<string, HistoryWeek>();
  const conflicting = new Set<string>();
  let invalid = 0;
  let future = 0;
  let notAvailable = 0;
  let duplicates = 0;

  for (const week of history) {
    try { mondayMs(week.weekStart); } catch { invalid += 1; continue; }
    if (!Number.isInteger(week.total) || week.total < 0) { invalid += 1; continue; }
    if (week.weekStart >= targetWeek) { future += 1; continue; }
    if (scheduleForWeek(week.weekStart).settlesAt >= reviewCutoff) {
      notAvailable += 1;
      continue;
    }
    const prior = unique.get(week.weekStart);
    if (prior) {
      duplicates += 1;
      if (prior.total !== week.total) conflicting.add(week.weekStart);
      else if (week.confirmed && !prior.confirmed) unique.set(week.weekStart, week);
    } else unique.set(week.weekStart, week);
  }

  const past = [...unique.values()]
    .filter((week) => !conflicting.has(week.weekStart))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  if (invalid) warnings.push(`已排除 ${invalid} 条日期或人数无效的记录。`);
  if (future) warnings.push(`已排除 ${future} 条本期及之后的记录，避免使用未来数据。`);
  if (notAvailable) warnings.push(`已排除 ${notAvailable} 条在审核开始时才达到确认时间的上周记录，避免假定它们已提前可用。`);
  if (duplicates) warnings.push("重复周只计一次；人数冲突的周已排除，需管理员核对。");

  const sample = referenceWeeks(past, targetWeek);
  const totals = sample.map((week) => week.total).sort((a, b) => a - b);
  const sampleSize = totals.length;
  const unconfirmed = sample.filter((week) => !week.confirmed).length;
  if (unconfirmed) warnings.push(`参考样本中 ${unconfirmed} 周来自观测登记，未经最终入职确认，可能受取消或补录影响。`);
  if (past.length) {
    const expected = Math.max(0, Math.round((target - mondayMs(past[0].weekStart)) / WEEK) - 1);
    const missing = Math.max(0, expected - past.length);
    if (missing) warnings.push(`从首个观测周到审核前可用周缺少 ${missing} 周记录，未将缺失周补为 0。`);
    const latestAge = Math.round((target - mondayMs(past[past.length - 1].weekStart)) / WEEK);
    if (latestAge > 4) warnings.push(`最近一条记录距本期 ${latestAge} 周，近期变化可能未反映。`);
  }
  warnings.push("无法确认零入职周是否完整登记；缺失周不补 0，零人类别的参考比例可能偏低。");
  warnings.push("数据没有逐条录入时间或当时版本；历史补录无法完全识别，MAE 仅为按业务时间回看的参考，不代表真实事前预测成绩。");
  warnings.push("历史分布不能体现临时取消、补录、节假日或天气变化，参考比例不代表确定结果。");
  if (sampleSize < 8) warnings.push(`仅有 ${sampleSize} 个参考周，样本偏少，分布和历史范围不稳定。`);

  const errors: number[] = [];
  for (let index = 8; index < past.length; index += 1) {
    const heldOut = past[index];
    const training = referenceWeeks(past.slice(0, index), heldOut.weekStart);
    if (training.length < 8) continue;
    const prediction = training.reduce((sum, week) => sum + week.total, 0) / training.length;
    errors.push(Math.abs(prediction - heldOut.total));
  }
  const evaluation = errors.slice(-12);
  const backtestMae = evaluation.length >= 3
    ? round2(evaluation.reduce((sum, error) => sum + error, 0) / evaluation.length)
    : null;
  if (backtestMae === null) warnings.push("可滚动验证的历史不足 3 期，暂不提供 MAE 误差参考。");

  const method = sampleSize
    ? `近期 12 个有记录的周，与往年同月日前后 4 周取并集，各周等权；只取确认时刻严格早于本期审核开始的周，保守排除上一周。范围为历史人数的 10%–90% 分位数向外取整，不是未来保证区间。类别比例使用每类 +0.5 的轻度平滑。${backtestMae === null ? "滚动验证样本不足。" : `MAE 使用最近 ${evaluation.length} 个有记录周逐期留后验证，各期采用相同审核截止规则，不包括未登记周。`}`
    : "暂无可用历史样本；数值 0 只是空数据占位，四类各 25% 仅为展示先验，不是基于历史的预测。";
  if (!sampleSize) warnings.unshift("暂无可用历史样本，均值和范围应显示为暂无数据，不能把占位数值 0 当作预测。");

  const counts = new Map<Category, number>(CATEGORIES.map((category) => [category, 0]));
  for (const total of totals) {
    const category = categoryFor(total, threshold);
    counts.set(category, counts.get(category)! + 1);
  }
  return {
    sampleSize,
    mean: sampleSize ? round2(totals.reduce((sum, total) => sum + total, 0) / sampleSize) : 0,
    median: sampleSize ? round2(quantile(totals, 0.5)) : 0,
    low: sampleSize ? Math.floor(quantile(totals, 0.1)) : 0,
    high: sampleSize ? Math.ceil(quantile(totals, 0.9)) : 0,
    probabilities: CATEGORIES.map((category) => ({
      category,
      probability: (counts.get(category)! + 0.5) / (sampleSize + CATEGORIES.length * 0.5),
    })),
    method,
    warnings,
    backtestMae,
  };
}
