// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import AppointmentAccountSummary from "./AppointmentAccountSummary.vue";

describe("AppointmentAccountSummary", () => {
  it("shows a profile snapshot with server, character and two copy controls", async () => {
    const wrapper = mount(AppointmentAccountSummary, {
      props: {
        contactName: "南枝",
        account: {
          source: "profile",
          characterName: "清心",
          server: "梦江南",
          specialization: "冰心",
          gearScore: "19.8万",
          accountName: "profile-login",
          password: "secret",
        },
      },
    });

    expect(wrapper.get(".appointment-account-summary__line--secondary").text()).toBe("梦江南·清心");
    expect(wrapper.find(".appointment-account-summary__account").exists()).toBe(false);
    expect(wrapper.findAll(".appointment-account-summary__copy")).toHaveLength(2);

    await wrapper.get('button[aria-label="复制账号 profile-login"]').trigger("click");
    expect(wrapper.emitted("copyAccount")).toHaveLength(1);
  });

  it("shows an embedded snapshot with a directly clickable account and disabled missing password", async () => {
    const wrapper = mount(AppointmentAccountSummary, {
      props: {
        contactName: "青禾",
        account: {
          source: "embedded",
          characterName: null,
          server: null,
          specialization: null,
          gearScore: null,
          accountName: "one-time-login",
          password: null,
        },
      },
    });

    expect(wrapper.get(".appointment-account-summary__line:first-child").text()).toBe("—·—");
    expect(wrapper.get(".appointment-account-summary__line--secondary").text()).toBe(
      "—·one-time-login",
    );
    const accountButton = wrapper.get('button[aria-label="复制账号 one-time-login"]');
    await accountButton.trigger("click");
    expect(wrapper.emitted("copyAccount")).toHaveLength(1);
    expect(wrapper.get('button[aria-label="复制青禾 的预约密码"]').attributes("disabled")).toBe("");
  });
});
