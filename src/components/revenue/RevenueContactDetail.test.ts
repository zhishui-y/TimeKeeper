// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import type { Appointment } from "../../types/domain";
import RevenueContactDetail from "./RevenueContactDetail.vue";

const appointment: Appointment = {
  id: "contact-appointment",
  serviceDate: "2026-08-01",
  startsAt: "2026-08-01T13:00:00+08:00",
  endsAt: "2026-08-01T14:00:00+08:00",
  contactName: "QQ|南枝",
  content: "竞技场",
  mode: "business",
  serviceStatus: "completed",
  settlementStatus: "settled",
  amountMinor: 12_000,
  voicePlatform: "yy",
  voiceChannel: "24680",
  notes: "收益对象备注",
  createdAt: "2026-08-01T00:00:00Z",
  updatedAt: "2026-08-01T00:00:00Z",
};

function mountDetail(props: Partial<InstanceType<typeof RevenueContactDetail>["$props"]> = {}) {
  return mount(RevenueContactDetail, {
    attachTo: document.body,
    props: {
      item: {
        name: "其他",
        amountMinor: 12_000,
        appointmentCount: 1,
        memberNames: ["南枝", "临时对象"],
      },
      from: "2026-07-27",
      to: "2026-08-02",
      appointments: [appointment],
      loading: false,
      error: null,
      ...props,
    },
    global: { stubs: { Teleport: true } },
  });
}

describe("RevenueContactDetail", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows merged-group context and forwards appointment selection", async () => {
    const wrapper = mountDetail();
    expect(wrapper.get("#contact-detail-title").text()).toBe("其他（合并）预约明细");
    expect(wrapper.text()).toContain("2026年7月27日 — 2026年8月2日");
    expect(wrapper.get(".contact-detail__summary").text()).toContain("合并对象2 个");
    expect(wrapper.text()).toContain("QQ|南枝");
    expect(wrapper.text()).toContain("YY·24680");
    expect(wrapper.text()).toContain("备注：收益对象备注");

    await wrapper.get(".revenue-appointment").trigger("click");
    expect((wrapper.emitted("appointmentSelect")?.[0]?.[0] as Appointment).id).toBe(appointment.id);
  });

  it("covers loading, empty, error, and stale states without enabling old rows", () => {
    const loading = mountDetail({ appointments: [], loading: true });
    expect(loading.find(".loading-line").exists()).toBe(true);
    loading.unmount();

    const empty = mountDetail({ appointments: [] });
    expect(empty.text()).toContain("该对象在当前范围内没有计入收益的预约");
    empty.unmount();

    const stale = mountDetail({
      error: "加载失败",
      stale: true,
      actionsDisabled: true,
      resolvedContactNames: ["上一对象"],
    });
    expect(stale.get('[role="alert"]').text()).toBe("加载失败");
    expect(stale.text()).toContain("上一对象：上一对象");
    expect(stale.get(".revenue-appointment").attributes("disabled")).toBeDefined();
  });

  it("closes with Escape and restores the chart trigger focus when unmounted", async () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const wrapper = mountDetail({ restoreFocusElement: trigger });
    await flushPromises();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(wrapper.emitted("close")).toHaveLength(1);
    wrapper.unmount();
    expect(document.activeElement).toBe(trigger);
  });
});
