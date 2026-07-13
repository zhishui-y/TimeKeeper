import { afterEach } from "vitest";

afterEach(() => {
  document.body.innerHTML = "";
});

class ResizeObserverStub implements ResizeObserver {
  disconnect(): void {}
  observe(): void {}
  unobserve(): void {}
}

globalThis.ResizeObserver = ResizeObserverStub;
