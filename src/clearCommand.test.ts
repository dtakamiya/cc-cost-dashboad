import { describe, it, expect } from "vitest";
import { buildClearCommand } from "./clearCommand";

describe("buildClearCommand", () => {
  it("cwd をシングルクォートで囲んだ claude clear コマンドを返す", () => {
    expect(buildClearCommand("/home/user/project")).toBe(
      "cd '/home/user/project' && claude clear"
    );
  });

  it("スペースを含むパスも安全に扱う", () => {
    expect(buildClearCommand("/home/user/my project")).toBe(
      "cd '/home/user/my project' && claude clear"
    );
  });

  it("cwd が空文字のときは cd なしで claude clear を返す", () => {
    expect(buildClearCommand("")).toBe("claude clear");
  });
});
