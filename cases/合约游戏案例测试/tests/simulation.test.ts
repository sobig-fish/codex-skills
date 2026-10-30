import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { simulationMultiplier } from "../core/simulation.ts";
import { buildForecast } from "../core/game.ts";
import type { HistoryWeek } from "../core/contracts.ts";

test("simulation display rejects invalid or absent probabilities", () => {
  for (const probability of [0, -0, -0.1, 1.01, Number.NaN, Infinity, -Infinity]) {
    assert.equal(simulationMultiplier(probability, 12), null, `probability=${probability}`);
  }
});

test("simulation display requires a positive safe integer sample count", () => {
  for (const sampleSize of [0, -1, 0.5, 1.5, Number.NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(simulationMultiplier(0.25, sampleSize), null, `sampleSize=${sampleSize}`);
  }
  assert.equal(simulationMultiplier(0.25, 1), 4);
  assert.equal(simulationMultiplier(0.25, Number.MAX_SAFE_INTEGER), 4);
});

test("simulation display caps rare outcomes at 20 without overflow", () => {
  assert.equal(simulationMultiplier(1, 12), 1);
  assert.equal(simulationMultiplier(0.05, 12), 20);
  assert.equal(simulationMultiplier(0.01, 12), 20);
  assert.equal(simulationMultiplier(Number.MIN_VALUE, 12), 20);
  assert.equal(simulationMultiplier(0.0501, 12), 19.96);
});

test("simulation display rounds reciprocals to two decimal places", () => {
  assert.equal(simulationMultiplier(0.3, 12), 3.33);
  assert.equal(simulationMultiplier(0.6, 12), 1.67);
  assert.equal(simulationMultiplier(0.8, 12), 1.25);
  assert.equal(simulationMultiplier(1 / 1.2344, 12), 1.23);
  assert.equal(simulationMultiplier(1 / 1.2351, 12), 1.24);
});

test("decimal half-cent ties round up rather than down because of floating-point noise", () => {
  assert.equal(simulationMultiplier(1 / 1.005, 12), 1.01);
  assert.equal(simulationMultiplier(1 / 2.005, 12), 2.01);
});

test("rarer outcomes have higher display values until the cap", () => {
  const values = [0.8, 0.5, 0.25, 0.1].map((probability) => simulationMultiplier(probability, 20));
  assert.deepEqual(values, [1.25, 2, 4, 10]);
  assert.equal(simulationMultiplier(0.04, 20), simulationMultiplier(0.001, 20));
  assert.equal(simulationMultiplier(0.25, 20), simulationMultiplier(0.25, 200));
});

test("a no-history forecast cannot produce an apparently supported simulation value", () => {
  const forecast = buildForecast([], "2026-11-02", 5);
  assert.equal(forecast.sampleSize, 0);
  assert.ok(forecast.probabilities.every((item) => simulationMultiplier(item.probability, forecast.sampleSize) === null));
});

test("synthetic fixture produces bounded finite simulation displays", () => {
  const source = JSON.parse(readFileSync(new URL("../fixtures/synthetic-history.json", import.meta.url), "utf8")) as { history: HistoryWeek[] };
  const forecast = buildForecast(source.history, "2026-11-02", 5);
  assert.ok(forecast.sampleSize > 0);
  const ordered = [...forecast.probabilities].sort((a, b) => a.probability - b.probability);
  const values = ordered.map((item) => simulationMultiplier(item.probability, forecast.sampleSize));
  for (const value of values) {
    assert.ok(value !== null && Number.isFinite(value) && value >= 1 && value <= 20);
  }
  for (let index = 1; index < values.length; index += 1) {
    assert.ok(values[index - 1]! >= values[index]!);
  }
});
