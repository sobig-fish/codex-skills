export type Category = "zero" | "below" | "equal" | "above";
export type Stage = "upcoming" | "review" | "open" | "closed" | "awaiting_result" | "settled" | "unpublished" | "cancelled";
export type HistoryWeek = { weekStart: string; total: number; monday: number; wednesday: number; other: number; confirmed: boolean; source: string };
export type Forecast = { sampleSize: number; mean: number; median: number; low: number; high: number; probabilities: { category: Category; probability: number }[]; method: string; warnings: string[]; backtestMae: number | null };
export type Round = { reviewStartsAt: number; opensAt: number; closesAt: number; settlesAt: number; approvedAt: number | null; result: number | null; cancelledAt: number | null };
