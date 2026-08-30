import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import AppointmentDrawerFooter from "./AppointmentDrawerFooter.vue";

const mountedWrappers: ReturnType<typeof mount>[] = [];

function mountFooter(props: Partial<InstanceType<typeof AppointmentDrawerFooter>["$props"]> = {}) {
  const wrapper = mount(AppointmentDrawerFooter, {
    attachTo: document.body,
    props: {
      editing: true,
      progressStatus: "scheduled",
      ...props,
    },
  });
  mountedWrappers.push(wrapper);
  return wrapper;
}

afterEach(() => {
  mountedWrappers.splice(0).forEach((wrapper) => wrapper.unmount());
});

describe("AppointmentDrawerFooter", () => {
  it("shows only close and save actions while creating", () => {
    const wrapper = mountFooter({ editing: false });

    expect(wrapper.find('button[aria-label="复制为今日预约"]').exists()).toBe(false);
    expect(wrapper.find('button[aria-haspopup="menu"]').exists()).toBe(false);
    expect(wrapper.get('button[aria-label="保存预约"]').text()).toContain("保存预约");
    expect(wrapper.get('button[aria-label="关闭预约编辑"]').text()).toBe("关闭");
  });

  it("keeps copy and complete visible and moves cancel and delete into the menu", async () => {
    const wrapper = mountFooter();

    expect(wrapper.get('button[aria-label="复制为今日预约"]').text()).toContain("复制");
    expect(wrapper.get('button[aria-label="完成预约"]').text()).toContain("标记完成");
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);

    await wrapper.get('button[aria-haspopup="menu"]').trigger("click");

    const menuItems = wrapper.findAll('[role="menuitem"]');
    expect(wrapper.emitted("menuOpenChange")?.[0]).toEqual([true]);
    expect(menuItems.map((item) => item.text().trim())).toEqual(["取消预约", "永久删除"]);

    await menuItems[0]!.trigger("click");
    expect(wrapper.emitted("cancel")).toHaveLength(1);
    expect(wrapper.emitted("menuOpenChange")?.[1]).toEqual([false]);
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
  });

  it("returns focus to more actions when Escape closes the menu", async () => {
    const wrapper = mountFooter();
    const trigger = wrapper.get<HTMLButtonElement>('button[aria-haspopup="menu"]');

    await trigger.trigger("click");
    expect(document.activeElement).toBe(wrapper.get('[role="menuitem"]').element);

    await wrapper.get('[role="menu"]').trigger("keydown", { key: "Escape" });

    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
    expect(document.activeElement).toBe(trigger.element);
  });

  it("closes the menu when a pointer event occurs outside", async () => {
    const wrapper = mountFooter();
    await wrapper.get('button[aria-haspopup="menu"]').trigger("click");

    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
  });

  it("disables completed and cancelled shortcuts in their terminal states", async () => {
    const completed = mountFooter({ progressStatus: "completed" });
    expect(completed.get('button[aria-label="完成预约"]').attributes("disabled")).toBeDefined();

    const cancelled = mountFooter({ progressStatus: "cancelled" });
    await cancelled.get('button[aria-haspopup="menu"]').trigger("click");
    expect(cancelled.get('[role="menuitem"]').attributes("disabled")).toBeDefined();
  });
});
