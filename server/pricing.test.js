import { describe, it, expect } from "vitest";
import request from "supertest";
import {
  PRICING,
  CACHE_WRITE_5M_MULTIPLIER,
  CACHE_WRITE_1H_MULTIPLIER,
  CACHE_READ_MULTIPLIER,
  knownModels,
  costOf,
} from "./pricing.js";
import { app } from "./index.js";

describe("GET /api/pricing", () => {
  it("200 を返し models と multipliers キーを持つ", async () => {
    const res = await request(app).get("/api/pricing");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("models");
    expect(res.body).toHaveProperty("multipliers");
  });

  it("models が PRICING テーブルと一致する", async () => {
    const res = await request(app).get("/api/pricing");
    expect(res.body.models).toEqual(PRICING);
  });

  it("multipliers が正しいキャッシュ乗数を返す", async () => {
    const res = await request(app).get("/api/pricing");
    expect(res.body.multipliers).toEqual({
      cacheWrite5m: CACHE_WRITE_5M_MULTIPLIER,
      cacheWrite1h: CACHE_WRITE_1H_MULTIPLIER,
      cacheRead: CACHE_READ_MULTIPLIER,
    });
  });
});

describe("PRICING table", () => {
  it("各エントリが正の input と output を持つ", () => {
    for (const [model, price] of Object.entries(PRICING)) {
      expect(price.input, `${model}.input`).toBeGreaterThan(0);
      expect(price.output, `${model}.output`).toBeGreaterThan(0);
    }
  });

  it("knownModels() が PRICING のキー一覧と一致する", () => {
    expect(knownModels()).toEqual(Object.keys(PRICING));
  });

  it("CACHE_WRITE_5M_MULTIPLIER が 1.25", () => {
    expect(CACHE_WRITE_5M_MULTIPLIER).toBe(1.25);
  });

  it("CACHE_WRITE_1H_MULTIPLIER が 2", () => {
    expect(CACHE_WRITE_1H_MULTIPLIER).toBe(2);
  });

  it("CACHE_READ_MULTIPLIER が 0.1", () => {
    expect(CACHE_READ_MULTIPLIER).toBe(0.1);
  });

  it("claude-opus-4-8 の価格が input=5, output=25", () => {
    expect(PRICING["claude-opus-4-8"]).toEqual({ input: 5, output: 25 });
  });

  it("claude-sonnet-4-5 の価格が input=3, output=15", () => {
    expect(PRICING["claude-sonnet-4-5"]).toEqual({ input: 3, output: 15 });
  });

  it("claude-haiku-4-5 の価格が input=1, output=5", () => {
    expect(PRICING["claude-haiku-4-5"]).toEqual({ input: 1, output: 5 });
  });

  it("claude-fable-5 の価格が input=10, output=50", () => {
    expect(PRICING["claude-fable-5"]).toEqual({ input: 10, output: 50 });
  });
});

describe("costOf", () => {
  it("既知モデルで isFallback=false を返す", () => {
    const result = costOf("claude-opus-4-8", { input: 1_000_000, output: 0 });
    expect(result.isFallback).toBe(false);
  });

  it("未知モデルで isFallback=true を返す", () => {
    const result = costOf("claude-unknown-99", { input: 1_000_000, output: 0 });
    expect(result.isFallback).toBe(true);
  });

  it("日付サフィックス付きモデル名を吸収する", () => {
    const withSuffix = costOf("claude-haiku-4-5-20251001", { input: 1_000_000, output: 0 });
    const withoutSuffix = costOf("claude-haiku-4-5", { input: 1_000_000, output: 0 });
    expect(withSuffix.total).toBeCloseTo(withoutSuffix.total, 10);
    expect(withSuffix.isFallback).toBe(false);
  });

  it("input 1M トークンのコストが rate.input / 1_000_000 × 1_000_000 = rate.input になる", () => {
    const result = costOf("claude-opus-4-8", { input: 1_000_000, output: 0 });
    // input: 5 USD/1Mトークン → 1M tokens = $5
    expect(result.input).toBeCloseTo(5, 6);
  });
});
