import { describe, it, expect } from "vitest";
import { modelColor, calcEffectiveRate } from "./format";

describe("modelColor", () => {
  it("claude-3-opus の日付サフィックス付きモデルに固有色を返す", () => {
    const color = modelColor("claude-3-opus-20240229");
    expect(color).toBeDefined();
    expect(color).not.toBe("");
    // 既知モデルなのでPALETTEローテーションではなく専用色
    expect(modelColor("claude-3-opus-20240229")).toBe(color);
  });

  it("claude-3-5-sonnet の日付サフィックス付きモデルに固有色を返す", () => {
    const color = modelColor("claude-3-5-sonnet-20241022");
    expect(color).toBeDefined();
    expect(color).not.toBe("");
    expect(modelColor("claude-3-5-sonnet-20241022")).toBe(color);
  });

  it("claude-3-5-haiku の日付サフィックス付きモデルに固有色を返す", () => {
    const color = modelColor("claude-3-5-haiku-20241022");
    expect(color).toBeDefined();
    expect(color).not.toBe("");
    expect(modelColor("claude-3-5-haiku-20241022")).toBe(color);
  });

  it("claude-3-haiku の日付サフィックス付きモデルに固有色を返す", () => {
    const color = modelColor("claude-3-haiku-20240307");
    expect(color).toBeDefined();
    expect(color).not.toBe("");
    expect(modelColor("claude-3-haiku-20240307")).toBe(color);
  });

  it("Claude 3.x モデル同士は異なる色を持つ", () => {
    const opusColor = modelColor("claude-3-opus-20240229");
    const sonnet35Color = modelColor("claude-3-5-sonnet-20241022");
    const haiku35Color = modelColor("claude-3-5-haiku-20241022");
    const haikuColor = modelColor("claude-3-haiku-20240307");

    const colors = [opusColor, sonnet35Color, haiku35Color, haikuColor];
    const uniqueColors = new Set(colors);
    expect(uniqueColors.size).toBe(4);
  });

  it("claude-3-5-sonnet プレフィックスで始まるモデルは同じ色を返す", () => {
    const color1 = modelColor("claude-3-5-sonnet-20241022");
    const color2 = modelColor("claude-3-5-sonnet-20240620");
    expect(color1).toBe(color2);
  });

  it("claude-3-opus プレフィックスで始まるモデルは同じ色を返す", () => {
    const color1 = modelColor("claude-3-opus-20240229");
    const color2 = modelColor("claude-3-opus-20240307");
    expect(color1).toBe(color2);
  });

  it("未知モデルも安定した色（同じ呼び出しは同じ色）を返す", () => {
    const color1 = modelColor("unknown-model-xyz");
    const color2 = modelColor("unknown-model-xyz");
    expect(color1).toBe(color2);
  });

  it("返す色は有効な16進数カラーコードである", () => {
    const hexPattern = /^#[0-9a-fA-F]{6}$/;
    expect(hexPattern.test(modelColor("claude-3-opus-20240229"))).toBe(true);
    expect(hexPattern.test(modelColor("claude-3-5-sonnet-20241022"))).toBe(true);
    expect(hexPattern.test(modelColor("unknown-future-model"))).toBe(true);
  });

  it("未知モデルは既知Claudeの固定色と衝突しない", () => {
    modelColor("claude-3-opus-20240229");
    modelColor("claude-3-5-sonnet-20241022");
    modelColor("claude-3-5-haiku-20241022");
    modelColor("claude-3-haiku-20240307");

    const unknownColor = modelColor("unknown-model-xyz");
    expect(["#fb7185", "#c084fc", "#22d3ee", "#a3e635"]).not.toContain(unknownColor);
  });
});

describe("calcEffectiveRate", () => {
  it("cost=3.6, tokens=1_200_000 のとき $3.00/MTok 相当の値を返す", () => {
    expect(calcEffectiveRate(3.6, 1_200_000)).toBeCloseTo(3.0, 6);
  });

  it("tokens=0 のときゼロ除算を防止し0を返す", () => {
    expect(calcEffectiveRate(3.6, 0)).toBe(0);
  });

  it("cost=0, tokens>0 のとき0を返す", () => {
    expect(calcEffectiveRate(0, 1_000_000)).toBe(0);
  });
});
