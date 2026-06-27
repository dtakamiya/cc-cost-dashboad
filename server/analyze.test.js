import { describe, it, expect } from "vitest";
import { parseSkillFrontmatter, measureSkillContent } from "./analyze.js";

const skill = (fm, body = "x".repeat(4000)) => `---\n${fm}\n---\n${body}`;

describe("parseSkillFrontmatter", () => {
  it("インライン name / description を抽出", () => {
    const c = skill("name: my-skill\ndescription: Does a thing.");
    expect(parseSkillFrontmatter(c)).toEqual({
      name: "my-skill",
      description: "Does a thing.",
    });
  });

  it("複数行（block scalar）description を結合", () => {
    const c = skill("name: multi\ndescription: >\n  line one\n  line two\nmetadata: x");
    const r = parseSkillFrontmatter(c);
    expect(r.name).toBe("multi");
    expect(r.description).toBe("line one line two");
  });

  it("frontmatter が無ければ空", () => {
    expect(parseSkillFrontmatter("no frontmatter here")).toEqual({ name: "", description: "" });
  });
});

describe("measureSkillContent (progressive disclosure)", () => {
  it("alwaysTokens は description のみ、fullTokens は全文", () => {
    const c = skill("name: s\ndescription: short desc", "B".repeat(8000));
    const m = measureSkillContent(c, "s");
    // 全文（~8KB超）は description（数十バイト）より遥かに大きい
    expect(m.fullTokens).toBeGreaterThan(m.alwaysTokens * 10);
    // baseline 互換フィールドは alwaysTokens と一致
    expect(m.estimatedTokens).toBe(m.alwaysTokens);
    expect(m.bytes).toBe(Buffer.byteLength(c, "utf8"));
  });

  it("description が無くても alwaysTokens は小さく fullTokens は全文サイズ", () => {
    const c = skill("name: s", "C".repeat(4000));
    const m = measureSkillContent(c, "s");
    expect(m.alwaysTokens).toBeLessThan(10);
    expect(m.fullTokens).toBeGreaterThan(900);
  });
});
