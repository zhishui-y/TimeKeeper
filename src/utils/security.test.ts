import { describe, expect, it } from "vitest";
import {
  MIN_MASTER_PASSWORD_CHARACTERS,
  isMasterPasswordLongEnough,
  masterPasswordCharacterCount,
} from "./security";

describe("master password validation", () => {
  it("uses the same four-character minimum for ASCII and Unicode text", () => {
    expect(MIN_MASTER_PASSWORD_CHARACTERS).toBe(4);
    expect(isMasterPasswordLongEnough("123")).toBe(false);
    expect(isMasterPasswordLongEnough("1234")).toBe(true);
    expect(masterPasswordCharacterCount("密碼🔒A")).toBe(4);
    expect(isMasterPasswordLongEnough("密碼🔒A")).toBe(true);
  });
});
