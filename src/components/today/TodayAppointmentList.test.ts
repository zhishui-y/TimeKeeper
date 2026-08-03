// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { Appointment } from "../../types/domain";
import TodayAppointmentList from "./TodayAppointmentList.vue";

function appointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: "appointment-1",
    serviceDate: "2026-08-03",
    contactName: "测试联系人",
    mode: "business",
    serviceStatus: "completed",
    settlementStatus: "unsettled",
    amountMinor: 18_000,
    createdAt: "2026-08-03T00:00:00Z",
    updatedAt: "2026-08-03T00:00:00Z",
    ...overrides,
  };
}

describe("TodayAppointmentList", () => {
  it("shows account, voice and notes metadata with the shared copy controls", async () => {
    const target = appointment({
      id: "metadata",
      serviceStatus: "scheduled",
      account: {
        specialization: "莫问",
        gearScore: "794676",
        server: "梦江南",
        accountName: "demo-account",
        password: "demo-secret",
      },
      voicePlatform: "yy",
      voiceChannel: "27364886",
      notes: "优先安排晚间时段",
    });
    const wrapper = mount(TodayAppointmentList, {
      props: {
        appointments: [
          target,
          appointment({
            id: "missing-password",
            account: {
              specialization: null,
              gearScore: null,
              server: null,
              accountName: "no-password",
              password: null,
            },
            voicePlatform: "yy",
            voiceChannel: null,
            notes: null,
          }),
          appointment({ id: "qq", account: null, voicePlatform: "qq" }),
          appointment({ id: "no-voice", account: null }),
        ],
        kicker: "TODAY",
        heading: "今日预约",
      },
    });

    const rows = wrapper.findAll(".appointment-row");
    const accountLines = rows[0]!
      .find(".appointment-account-summary")
      .findAll(".appointment-account-summary__line");
    expect(accountLines[0]!.text()).toBe("莫问·794676");
    expect(accountLines[1]!.text()).toBe("梦江南");
    expect(accountLines[1]!.findAll("button")).toHaveLength(2);
    expect(accountLines[1]!.text()).not.toContain("demo-account");
    expect(accountLines[1]!.text()).not.toContain("••••••");
    expect(accountLines[1]!.find('button[aria-label^="显示"]').exists()).toBe(false);
    expect(rows[0]!.get(".appointment-row__voice").text()).toBe("27364886");
    expect(rows[0]!.get(".appointment-row__notes").text()).toBe("备注：优先安排晚间时段");
    expect(rows[0]!.get(".appointment-row__notes").attributes("title")).toBe("优先安排晚间时段");

    await wrapper.get('button[aria-label="复制账号 demo-account"]').trigger("click");
    await wrapper.get('button[aria-label="复制测试联系人 的预约密码"]').trigger("click");
    await wrapper.get('button[aria-label="复制YY频道 27364886"]').trigger("click");
    expect(wrapper.emitted("copyAccount")).toEqual([[target]]);
    expect(wrapper.emitted("copyPassword")).toEqual([[target]]);
    expect(wrapper.emitted("copyVoiceChannel")).toEqual([[target]]);
    expect(wrapper.get('button[aria-label="复制YY频道 27364886"]').find("svg").exists()).toBe(
      false,
    );

    expect(
      rows[1]!.get('button[aria-label="复制测试联系人 的预约密码"]').attributes("disabled"),
    ).toBe("");
    expect(rows[1]!.get(".appointment-row__voice").text()).toBe("—");
    expect(rows[1]!.get(".appointment-row__notes").text()).toBe("备注：—");
    expect(rows[2]!.get(".appointment-account-summary__empty").text()).toBe("未使用账号");
    expect(rows[2]!.get(".appointment-row__voice").text()).toBe("QQ");
    expect(rows[3]!.get(".appointment-row__voice").text()).toBe("—");

    const scheduledActions = rows[0]!
      .findAll(".appointment-row__actions button")
      .map((button) => button.attributes("aria-label"));
    expect(scheduledActions).toEqual(["编辑预约", "删除预约"]);
    expect(wrapper.find('button[aria-label="开始预约"]').exists()).toBe(false);
    expect(wrapper.find('button[aria-label="复制账号密码"]').exists()).toBe(false);
  });

  it("shows one unified status and exposes settlement only for pending business appointments", () => {
    const wrapper = mount(TodayAppointmentList, {
      props: {
        appointments: [
          appointment(),
          appointment({ id: "settled", settlementStatus: "settled" }),
          appointment({
            id: "entertainment",
            mode: "entertainment",
            settlementStatus: "not_applicable",
          }),
        ],
        kicker: "TODAY",
        heading: "今日预约",
      },
    });

    const rows = wrapper.findAll(".appointment-row");
    expect(rows[0]?.findAll(".badge")).toHaveLength(1);
    expect(rows[0]?.get(".badge").text()).toBe("待结算");
    expect(rows[0]?.find('button[aria-label="编辑结算"]').exists()).toBe(true);
    expect(rows[1]?.get(".badge").text()).toBe("已完成");
    expect(rows[1]?.find('button[aria-label="编辑结算"]').exists()).toBe(false);
    expect(rows[2]?.get(".badge").text()).toBe("已完成");
  });
});
