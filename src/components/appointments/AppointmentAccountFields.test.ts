// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockApi } from "../../api/mockClient";
import AppointmentAccountFields from "./AppointmentAccountFields.vue";

describe("AppointmentAccountFields", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps profile provenance until the user explicitly switches the snapshot to one-time", async () => {
    const wrapper = mount(AppointmentAccountFields, {
      props: {
        accounts: [],
        modelValue: {
          kind: "embedded",
          profileId: "",
          details: {
            accountName: "profile-login",
            server: "梦江南",
            specialization: "冰心",
            gearScore: "19.8万",
          },
          credentialKind: "keep",
          password: "",
          sourceAppointmentId: "",
          hasPassword: true,
          source: "profile",
          characterName: "清心",
          preservesSnapshot: true,
        },
      },
    });

    expect(wrapper.get('label[aria-label="档案账号快照，点击改为一次性账号"]').text()).toContain(
      "档案账号快照",
    );
    await wrapper.get('input[type="radio"][value="embedded"]').trigger("click");

    expect(wrapper.emitted("update:modelValue")?.[0]?.[0]).toEqual(
      expect.objectContaining({
        source: "embedded",
        characterName: null,
        preservesSnapshot: false,
      }),
    );
  });

  it("shows recent one-time accounts and applies password reuse without exposing the password", async () => {
    vi.spyOn(mockApi, "listRecentEmbeddedAccountPresets").mockResolvedValue([
      {
        sourceAppointmentId: "with-password",
        accountName: "recent-login",
        specialization: "冰心诀",
        server: "梦江南",
        gearScore: "20万",
        hasPassword: true,
      },
      {
        sourceAppointmentId: "without-password",
        accountName: "no-secret",
        specialization: null,
        server: null,
        gearScore: null,
        hasPassword: false,
      },
    ]);
    const wrapper = mount(AppointmentAccountFields, {
      props: {
        accounts: [],
        modelValue: {
          kind: "embedded",
          profileId: "",
          details: { accountName: "", specialization: null, gearScore: null, server: null },
          credentialKind: "replace",
          password: "",
          sourceAppointmentId: "",
          hasPassword: false,
          source: "embedded",
          characterName: null,
          preservesSnapshot: false,
        },
      },
    });
    await flushPromises();

    expect(mockApi.listRecentEmbeddedAccountPresets).toHaveBeenCalledWith(10);
    const recentToggle = wrapper.get('button[aria-label="展开最近使用"]');
    expect(recentToggle.attributes("aria-expanded")).toBe("false");
    expect(wrapper.find("#embedded-presets-panel").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("冰心诀-梦江南-20万-recent-login");

    await recentToggle.trigger("click");
    expect(wrapper.get('button[aria-label="收起最近使用"]').attributes("aria-expanded")).toBe(
      "true",
    );
    expect(wrapper.text()).toContain("冰心诀-梦江南-20万-recent-login");
    expect(wrapper.text()).toContain("职业未填-区服未填-装分未填-no-secret");

    await wrapper.get('button[title="冰心诀-梦江南-20万-recent-login"]').trigger("click");
    const passwordPresetUpdates = wrapper.emitted("update:modelValue") ?? [];
    expect(passwordPresetUpdates[passwordPresetUpdates.length - 1]?.[0]).toMatchObject({
      details: {
        accountName: "recent-login",
        specialization: "冰心诀",
        server: "梦江南",
        gearScore: "20万",
      },
      credentialKind: "copyFromAppointment",
      sourceAppointmentId: "with-password",
      password: "",
      source: "embedded",
      preservesSnapshot: false,
    });

    await wrapper.get('button[title="职业未填-区服未填-装分未填-no-secret"]').trigger("click");
    const passwordlessPresetUpdates = wrapper.emitted("update:modelValue") ?? [];
    expect(passwordlessPresetUpdates[passwordlessPresetUpdates.length - 1]?.[0]).toMatchObject({
      details: { accountName: "no-secret" },
      credentialKind: "replace",
      sourceAppointmentId: "",
      password: "",
    });
  });
});
