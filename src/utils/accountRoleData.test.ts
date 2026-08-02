import { describe, expect, it } from "vitest";
import { validateAccountRoleDataServerUrl } from "./accountRoleData";

describe("account role data server URL", () => {
  it("accepts absolute HTTP bases and rejects credentials, query, fragment, and invalid schemes", () => {
    expect(validateAccountRoleDataServerUrl("https://example.test/api/")).toBeNull();
    expect(validateAccountRoleDataServerUrl("http://127.0.0.1:8080/jx3")).toBeNull();
    expect(validateAccountRoleDataServerUrl("https://user:pass@example.test/")).toContain(
      "用户名或密码",
    );
    expect(validateAccountRoleDataServerUrl("https://example.test/?token=x")).toContain("查询参数");
    expect(validateAccountRoleDataServerUrl("https://example.test/#x")).toContain("片段");
    expect(validateAccountRoleDataServerUrl("file:///tmp/data")).toContain("http 或 https");
  });
});
