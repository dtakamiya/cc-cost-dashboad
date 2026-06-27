import { describe, it, expect } from "vitest";
import { buildClearCommand } from "./clearCommand";

describe("buildClearCommand", () => {
  it("cwd を含む claude clear コマンドを返す", () => {
    expect(buildClearCommand("/home/user/project")).toBe(
      "cd /home/user/project && claude clear"
    );
  });

  it("Windows 風パスも正しく含まれる", () => {
    expect(buildClearCommand("C:\\Users\\user\\project")).toBe(
      "cd C:\\Users\\user\\project && claude clear"
    );
  });

  it("cwd が空文字でも壊れない", () => {
    expect(buildClearCommand("")).toBe("cd  && claude clear");
  });
});
