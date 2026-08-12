import { expect, test } from "@playwright/test";

test("开发响应头与 CSP 负向探针阻断动态脚本、远端连接、frame 和 worker", async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "代表视口执行 CSP 负向探针");
  const response = await request.get("/");
  const policy = response.headers()["content-security-policy"] ?? "";
  expect(policy).toContain("default-src 'self'");
  expect(policy).toContain("script-src 'self'");
  expect(policy).toContain("frame-src 'none'");
  expect(policy).toContain("frame-ancestors 'none'");
  expect(policy).toContain("worker-src 'none'");

  await page.goto("/");
  const probe = await page.evaluate(async () => {
    const directives: string[] = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      directives.push(event.effectiveDirective);
    });

    try {
      new Function("return 1")();
    } catch {
      // Expected: script-src does not allow unsafe-eval.
    }
    const inlineScript = document.createElement("script");
    inlineScript.textContent = "globalThis.__timekeeperUnexpectedInlineScript = true";
    document.head.append(inlineScript);
    try {
      await fetch("https://example.com/timekeeper-csp-probe");
    } catch {
      // Expected: connect-src is restricted to local IPC and the dev server.
    }
    const frame = document.createElement("iframe");
    frame.src = "https://example.com/timekeeper-csp-frame";
    document.body.append(frame);
    try {
      const workerUrl = URL.createObjectURL(
        new Blob(["self.postMessage('unexpected')"], { type: "text/javascript" }),
      );
      const worker = new Worker(workerUrl);
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
    } catch {
      // Expected: worker-src is none.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    frame.remove();
    return {
      directives,
      inlineExecuted: Boolean(
        (globalThis as typeof globalThis & { __timekeeperUnexpectedInlineScript?: boolean })
          .__timekeeperUnexpectedInlineScript,
      ),
    };
  });

  expect(probe.inlineExecuted).toBe(false);
  expect(probe.directives).toEqual(
    expect.arrayContaining(["script-src-elem", "connect-src", "frame-src", "worker-src"]),
  );
});
