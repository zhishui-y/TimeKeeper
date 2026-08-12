import type { ApiClient } from "../types";
import type { MockStore } from "./store";
import {
  accountTableColumnWidthsAreValid,
  appointmentTableColumnWidthsAreValid,
  storeAccountTableColumnWidths,
  storeAppointmentTableColumnWidths,
} from "./tableWidths";
import { validateAccountRoleDataServerUrl } from "../../utils/accountRoleData";

type MockSettingsApi = Pick<
  ApiClient,
  | "getAppAppearance"
  | "getSettings"
  | "updateSettings"
  | "updateAccountTableColumnWidths"
  | "updateAppointmentTableColumnWidths"
  | "requestNotificationPermission"
>;

const MAX_DEFAULT_REMINDER_MINUTES = 1_440;

function defaultReminderMinutesAreValid(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= MAX_DEFAULT_REMINDER_MINUTES;
}

export function createMockSettingsApi(store: MockStore): MockSettingsApi {
  return {
    async getAppAppearance() {
      return {
        fontFamily: store.settings.fontFamily,
        baseFontSize: store.settings.baseFontSize,
      };
    },
    async getSettings() {
      return structuredClone(store.settings);
    },
    async updateSettings(nextSettings) {
      if (!defaultReminderMinutesAreValid(nextSettings.defaultReminderMinutes)) {
        throw new Error("默认提醒时间必须是0到1440分钟之间的整数");
      }
      if (
        !Number.isInteger(nextSettings.backupRetention) ||
        nextSettings.backupRetention < 1 ||
        nextSettings.backupRetention > 365
      ) {
        throw new Error("备份保留数量必须是1到365之间的整数");
      }
      if (!accountTableColumnWidthsAreValid(nextSettings.accountTableColumnWidths)) {
        throw new Error("账号表格列宽超出允许范围");
      }
      if (!appointmentTableColumnWidthsAreValid(nextSettings.appointmentTableColumnWidths)) {
        throw new Error("预约表格列宽超出允许范围");
      }
      const serverUrlError = validateAccountRoleDataServerUrl(
        nextSettings.accountRoleDataServerUrl,
      );
      if (serverUrlError) throw new Error(serverUrlError);
      storeAccountTableColumnWidths(nextSettings.accountTableColumnWidths);
      storeAppointmentTableColumnWidths(nextSettings.appointmentTableColumnWidths);
      store.settings = {
        ...nextSettings,
        accountTableColumnWidths: { ...nextSettings.accountTableColumnWidths },
        appointmentTableColumnWidths: { ...nextSettings.appointmentTableColumnWidths },
        accountRoleDataServerUrl: nextSettings.accountRoleDataServerUrl.trim(),
        accountRoleDataApiKey: nextSettings.accountRoleDataApiKey.trim(),
      };
      return structuredClone(store.settings);
    },
    async updateAccountTableColumnWidths(widths) {
      if (!accountTableColumnWidthsAreValid(widths)) {
        throw new Error("账号表格列宽超出允许范围");
      }
      store.settings.accountTableColumnWidths = structuredClone(widths);
      storeAccountTableColumnWidths(widths);
      return structuredClone(store.settings.accountTableColumnWidths);
    },
    async updateAppointmentTableColumnWidths(widths) {
      if (!appointmentTableColumnWidthsAreValid(widths)) {
        throw new Error("预约表格列宽超出允许范围");
      }
      store.settings.appointmentTableColumnWidths = structuredClone(widths);
      storeAppointmentTableColumnWidths(widths);
      return structuredClone(store.settings.appointmentTableColumnWidths);
    },
    async requestNotificationPermission() {
      return "granted";
    },
  };
}
