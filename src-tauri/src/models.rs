use std::{fmt, str::FromStr};

use serde::{Deserialize, Serialize};

macro_rules! string_enum {
    ($name:ident { $($variant:ident => $value:literal),+ $(,)? }) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
        #[serde(rename_all = "snake_case")]
        pub enum $name {
            $($variant),+
        }

        impl $name {
            pub const fn as_str(self) -> &'static str {
                match self {
                    $(Self::$variant => $value),+
                }
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str(self.as_str())
            }
        }

        impl FromStr for $name {
            type Err = String;

            fn from_str(value: &str) -> Result<Self, Self::Err> {
                match value {
                    $($value => Ok(Self::$variant)),+,
                    _ => Err(format!("无效的 {} 值: {value}", stringify!($name))),
                }
            }
        }
    };
}

string_enum!(AppointmentMode {
    Entertainment => "entertainment",
    Business => "business",
});

string_enum!(ServiceStatus {
    Scheduled => "scheduled",
    InProgress => "in_progress",
    Completed => "completed",
    Cancelled => "cancelled",
});

string_enum!(SettlementStatus {
    NotApplicable => "not_applicable",
    Unsettled => "unsettled",
    Settled => "settled",
});

string_enum!(AppointmentProgressStatus {
    Scheduled => "scheduled",
    InProgress => "in_progress",
    PendingSettlement => "pending_settlement",
    Completed => "completed",
    Cancelled => "cancelled",
});

string_enum!(AppointmentAccountSource {
    Profile => "profile",
    Embedded => "embedded",
});

string_enum!(VoicePlatform {
    Yy => "yy",
    Qq => "qq",
});

string_enum!(ReportGranularity {
    Day => "day",
    Week => "week",
    Month => "month",
});

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppointmentAccountDetails {
    pub specialization: Option<String>,
    pub gear_score: Option<String>,
    pub server: Option<String>,
    pub account_name: String,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppointmentAccount {
    pub source: AppointmentAccountSource,
    pub character_name: Option<String>,
    pub specialization: Option<String>,
    pub gear_score: Option<String>,
    pub server: Option<String>,
    pub account_name: String,
    pub password: Option<String>,
}

impl fmt::Debug for AppointmentAccount {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("AppointmentAccount")
            .field("source", &self.source)
            .field("character_name", &self.character_name)
            .field("specialization", &self.specialization)
            .field("gear_score", &self.gear_score)
            .field("server", &self.server)
            .field("account_name", &self.account_name)
            .field("password", &self.password.as_ref().map(|_| "<redacted>"))
            .finish()
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AppointmentAccountCredentialInput {
    None,
    Keep,
    Replace { password: String },
    CopyFromAppointment { source_appointment_id: String },
}

impl fmt::Debug for AppointmentAccountCredentialInput {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::None => formatter.write_str("None"),
            Self::Keep => formatter.write_str("Keep"),
            Self::Replace { .. } => formatter
                .debug_struct("Replace")
                .field("password", &"<redacted>")
                .finish(),
            Self::CopyFromAppointment {
                source_appointment_id,
            } => formatter
                .debug_struct("CopyFromAppointment")
                .field("source_appointment_id", source_appointment_id)
                .finish(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AppointmentAccountInput {
    Profile {
        profile_id: String,
    },
    Embedded {
        details: AppointmentAccountDetails,
        credential: AppointmentAccountCredentialInput,
    },
    Snapshot {
        source: AppointmentAccountSource,
        #[serde(default)]
        character_name: Option<String>,
        details: AppointmentAccountDetails,
        credential: AppointmentAccountCredentialInput,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Appointment {
    pub id: String,
    pub service_date: String,
    pub starts_at: Option<String>,
    pub ends_at: Option<String>,
    pub contact_name: String,
    pub content: Option<String>,
    pub mode: AppointmentMode,
    pub service_status: ServiceStatus,
    pub settlement_status: SettlementStatus,
    pub account: Option<AppointmentAccount>,
    pub voice_platform: Option<VoicePlatform>,
    pub voice_channel: Option<String>,
    pub rate_note: Option<String>,
    pub payment_method: Option<String>,
    pub amount_minor: Option<i64>,
    pub reminder_minutes: Option<i64>,
    pub notes: Option<String>,
    pub import_fingerprint: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppointmentInput {
    pub service_date: String,
    #[serde(default)]
    pub start_time: Option<String>,
    #[serde(default)]
    pub end_time: Option<String>,
    pub contact_name: String,
    #[serde(default)]
    pub content: Option<String>,
    pub mode: AppointmentMode,
    pub service_status: ServiceStatus,
    pub settlement_status: SettlementStatus,
    #[serde(default)]
    pub account: Option<AppointmentAccountInput>,
    #[serde(default)]
    pub voice_platform: Option<VoicePlatform>,
    #[serde(default)]
    pub voice_channel: Option<String>,
    #[serde(default)]
    pub rate_note: Option<String>,
    #[serde(default)]
    pub payment_method: Option<String>,
    #[serde(default)]
    pub amount_minor: Option<i64>,
    #[serde(default)]
    pub reminder_minutes: Option<i64>,
    #[serde(default)]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppointmentFilters {
    pub from: Option<String>,
    pub to: Option<String>,
    pub query: Option<String>,
    pub mode: Option<AppointmentMode>,
    pub progress_status: Option<AppointmentProgressStatus>,
    pub service_status: Option<ServiceStatus>,
    pub settlement_status: Option<SettlementStatus>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppointmentPage {
    pub items: Vec<Appointment>,
    pub total_count: i64,
    pub page: i64,
    pub page_size: i64,
    pub total_pages: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppointmentSelectionSnapshot {
    pub token: String,
    pub total_count: i64,
    pub expires_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AppointmentDeleteSelection {
    Explicit {
        ids: Vec<String>,
    },
    Token {
        token: String,
        #[serde(default)]
        excluded_ids: Vec<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppointmentDeleteResult {
    pub matched_count: i64,
    pub deleted_count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactPreset {
    pub source_appointment_id: String,
    pub service_date: String,
    pub contact_name: String,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub content: Option<String>,
    pub mode: AppointmentMode,
    pub account: Option<AppointmentAccount>,
    pub rate_note: Option<String>,
    pub payment_method: Option<String>,
    pub amount_minor: Option<i64>,
    pub reminder_minutes: Option<i64>,
    pub notes: Option<String>,
    pub voice_platform: Option<VoicePlatform>,
    pub voice_channel: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddedAccountPreset {
    pub source_appointment_id: String,
    pub account_name: String,
    pub specialization: Option<String>,
    pub server: Option<String>,
    pub gear_score: Option<String>,
    pub has_password: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppointmentConflict {
    pub id: String,
    pub contact_name: String,
    pub starts_at: String,
    pub ends_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppointmentMutationResult {
    pub appointment: Appointment,
    pub conflicts: Vec<AppointmentConflict>,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountProfile {
    pub id: String,
    pub contact_name: Option<String>,
    pub server: Option<String>,
    pub character_name: Option<String>,
    pub specialization: Option<String>,
    pub gear_score: Option<String>,
    pub account_name: String,
    pub password: Option<String>,
    pub current_score: Option<i64>,
    pub highest_score: Option<i64>,
    pub score_updated_at: Option<String>,
    pub weekly_wins: Option<i64>,
    pub notes: Option<String>,
    pub needs_review: bool,
    pub import_fingerprint: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl fmt::Debug for AccountProfile {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("AccountProfile")
            .field("id", &self.id)
            .field("account_name", &self.account_name)
            .field("password", &self.password.as_ref().map(|_| "<redacted>"))
            .field("needs_review", &self.needs_review)
            .finish_non_exhaustive()
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AccountProfileCredentialInput {
    Keep,
    Replace { password: String },
    Remove,
}

impl fmt::Debug for AccountProfileCredentialInput {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Keep => formatter.write_str("Keep"),
            Self::Replace { .. } => formatter
                .debug_struct("Replace")
                .field("password", &"<redacted>")
                .finish(),
            Self::Remove => formatter.write_str("Remove"),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountProfileInput {
    #[serde(default)]
    pub contact_name: Option<String>,
    #[serde(default)]
    pub server: Option<String>,
    #[serde(default)]
    pub character_name: Option<String>,
    #[serde(default)]
    pub specialization: Option<String>,
    #[serde(default)]
    pub gear_score: Option<String>,
    pub account_name: String,
    pub credential: AccountProfileCredentialInput,
    #[serde(default)]
    pub current_score: Option<i64>,
    #[serde(default)]
    pub highest_score: Option<i64>,
    #[serde(default)]
    pub score_updated_at: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub needs_review: Option<bool>,
}

impl fmt::Debug for AccountProfileInput {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("AccountProfileInput")
            .field("account_name", &self.account_name)
            .field("credential", &self.credential)
            .field("needs_review", &self.needs_review)
            .finish_non_exhaustive()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevenuePoint {
    pub period: String,
    pub settled_minor: i64,
    pub unsettled_minor: i64,
    pub pending_count: i64,
    pub business_hours: f64,
    pub appointment_count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevenueBreakdownItem {
    pub name: String,
    pub amount_minor: i64,
    pub appointment_count: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevenueSummary {
    pub from: String,
    pub to: String,
    pub settled_minor: i64,
    pub unsettled_minor: i64,
    pub pending_count: i64,
    pub business_hours: f64,
    pub average_hourly_minor: i64,
    pub appointment_count: i64,
    pub completed_count: i64,
    pub payment_methods: Vec<RevenueBreakdownItem>,
    pub contacts: Vec<RevenueBreakdownItem>,
    pub points: Vec<RevenuePoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardSummary {
    pub today_settled_minor: i64,
    pub week_settled_minor: i64,
    pub pending_count: i64,
    pub next_appointment: Option<Appointment>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_dtos_as_camel_case() {
        let account = AppointmentAccount {
            source: AppointmentAccountSource::Embedded,
            character_name: None,
            specialization: None,
            gear_score: None,
            server: None,
            account_name: "demo".into(),
            password: Some("secret".into()),
        };

        let value = serde_json::to_value(account).unwrap();
        assert_eq!(value["accountName"], "demo");
        assert_eq!(value["source"], "embedded");
        assert_eq!(value["password"], "secret");
        assert!(value.get("account_name").is_none());
    }

    #[test]
    fn account_input_uses_tagged_camel_case_union() {
        let input = AppointmentAccountInput::Embedded {
            details: AppointmentAccountDetails {
                specialization: None,
                gear_score: None,
                server: Some("梦江南".into()),
                account_name: "demo".into(),
            },
            credential: AppointmentAccountCredentialInput::CopyFromAppointment {
                source_appointment_id: "appointment-1".into(),
            },
        };

        let value = serde_json::to_value(input).unwrap();
        assert_eq!(value["kind"], "embedded");
        assert_eq!(value["details"]["accountName"], "demo");
        assert_eq!(value["credential"]["kind"], "copyFromAppointment");
        assert_eq!(value["credential"]["sourceAppointmentId"], "appointment-1");

        let profile: AppointmentAccountInput = serde_json::from_value(serde_json::json!({
            "kind": "profile",
            "profileId": "profile-1"
        }))
        .unwrap();
        assert!(matches!(
            profile,
            AppointmentAccountInput::Profile { profile_id } if profile_id == "profile-1"
        ));
    }

    #[test]
    fn enum_wire_values_match_the_typescript_contract() {
        assert_eq!(
            serde_json::to_string(&ServiceStatus::InProgress).unwrap(),
            "\"in_progress\""
        );
        assert_eq!(SettlementStatus::NotApplicable.as_str(), "not_applicable");

        let credential = AccountProfileCredentialInput::Replace {
            password: "secret".into(),
        };
        let value = serde_json::to_value(credential).unwrap();
        assert_eq!(value["kind"], "replace");
        assert_eq!(value["password"], "secret");
        assert_eq!(
            serde_json::to_value(AccountProfileCredentialInput::Remove).unwrap()["kind"],
            "remove"
        );
    }

    #[test]
    fn sensitive_dto_debug_output_redacts_passwords() {
        let secret = "must-not-appear-in-debug";
        let account = AppointmentAccount {
            source: AppointmentAccountSource::Embedded,
            character_name: None,
            specialization: None,
            gear_score: None,
            server: None,
            account_name: "demo".into(),
            password: Some(secret.into()),
        };
        let credential = AppointmentAccountCredentialInput::Replace {
            password: secret.into(),
        };
        let profile_input = AccountProfileInput {
            contact_name: None,
            server: None,
            character_name: None,
            specialization: None,
            gear_score: None,
            account_name: "demo".into(),
            credential: AccountProfileCredentialInput::Replace {
                password: secret.into(),
            },
            current_score: None,
            highest_score: None,
            score_updated_at: None,
            notes: None,
            needs_review: None,
        };

        for output in [
            format!("{account:?}"),
            format!("{credential:?}"),
            format!("{profile_input:?}"),
        ] {
            assert!(!output.contains(secret));
            assert!(output.contains("<redacted>"));
        }
    }
}
