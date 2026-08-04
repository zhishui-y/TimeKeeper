// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import AppointmentAccountFields from "./AppointmentAccountFields.vue";

describe("AppointmentAccountFields", () => {
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

    expect(wrapper.get('button[aria-label="档案账号快照，点击改为一次性账号"]').text()).toContain(
      "档案账号快照",
    );
    await wrapper.get('button[aria-label="档案账号快照，点击改为一次性账号"]').trigger("click");

    expect(wrapper.emitted("update:modelValue")?.[0]?.[0]).toEqual(
      expect.objectContaining({
        source: "embedded",
        characterName: null,
        preservesSnapshot: false,
      }),
    );
  });
});
