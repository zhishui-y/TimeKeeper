import { describe, expect, it } from "vitest";
import { useAsyncResource } from "./useAsyncResource";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("useAsyncResource", () => {
  it("retains resolved data with its key and marks a failed replacement stale", async () => {
    const resource = useAsyncResource<number, string>((left, right) => left === right);
    await resource.load("old", async () => 1);
    const failed = resource.load("new", async () => {
      throw new Error("加载失败");
    });

    expect(resource.status.value).toBe("stale");
    expect(resource.actionsDisabled.value).toBe(true);
    await failed;
    expect(resource.data.value).toBe(1);
    expect(resource.resolvedKey.value).toBe("old");
    expect(resource.requestedKey.value).toBe("new");
    expect(resource.status.value).toBe("error");
    expect(resource.stale.value).toBe(true);
  });

  it("allows only the latest response to resolve state", async () => {
    const first = deferred<number>();
    const second = deferred<number>();
    const resource = useAsyncResource<number, string>((left, right) => left === right);
    const firstLoad = resource.load("first", () => first.promise);
    const secondLoad = resource.load("second", () => second.promise);

    second.resolve(2);
    await secondLoad;
    first.resolve(1);
    await firstLoad;

    expect(resource.data.value).toBe(2);
    expect(resource.resolvedKey.value).toBe("second");
    expect(resource.status.value).toBe("ready");
  });

  it("records a canonical key returned by the successful resource response", async () => {
    const resource = useAsyncResource<{ page: number }, number>((left, right) => left === right);

    await resource.load(
      5,
      async () => ({ page: 4 }),
      (result) => result.page,
    );

    expect(resource.requestedKey.value).toBe(4);
    expect(resource.resolvedKey.value).toBe(4);
    expect(resource.status.value).toBe("ready");
    expect(resource.stale.value).toBe(false);
  });
});
