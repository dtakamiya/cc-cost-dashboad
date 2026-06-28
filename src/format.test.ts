import { describe, it, expect } from "vitest";
import { modelColor } from "./format";

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
});
