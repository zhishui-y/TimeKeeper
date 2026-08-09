// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import AppBrandIcon from "./AppBrandIcon.vue";

describe("AppBrandIcon", () => {
  it("reuses the Tauri SVG icon as a decorative frontend brand mark", () => {
    const wrapper = mount(AppBrandIcon);
    const image = wrapper.get("img");

    expect(image.attributes("src")).toMatch(/^data:image\/svg\+xml,/);
    expect(image.attributes("alt")).toBe("");
    expect(image.attributes("aria-hidden")).toBe("true");
  });
});
