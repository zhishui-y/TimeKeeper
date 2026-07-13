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

string_enum!(ReportGranularity {
    Day => "day",
    Week => "week",
    Month => "month",
});

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountSnapshot {
    pub account_name: String,
    pub contact_name: Option<String>,
    pub server: Option<String>,
    pub character_name: Option<String>,
    pub specialization: Option<String>,
    pub gear_score: Option<String>,
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
    pub account_profile_id: Option<String>,
    pub account_snapshot: Option<AccountSnapshot>,
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
    pub account_profile_id: Option<String>,
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
    pub service_status: Option<ServiceStatus>,
    pub settlement_status: Option<SettlementStatus>,
    pub account_profile_id: Option<String>,
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountProfile {
    pub id: String,
    pub contact_name: Option<String>,
    pub server: Option<String>,
    pub character_name: Option<String>,
    pub specialization: Option<String>,
    pub gear_score: Option<String>,
    pub account_name: String,
    pub current_score: Option<i64>,
    pub highest_score: Option<i64>,
    pub score_updated_at: Option<String>,
    pub notes: Option<String>,
    pub needs_review: bool,
    pub import_fingerprint: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    #[serde(default)]
    pub password: Option<String>,
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevenuePoint {
    pub period: String,
    pub settled_minor: i64,
    pub unsettled_minor: i64,
    pub business_hours: f64,
    pub appointment_count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentMethodSummary {
    pub name: String,
    pub amount_minor: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevenueSummary {
    pub from: String,
    pub to: String,
    pub settled_minor: i64,
    pub unsettled_minor: i64,
    pub business_hours: f64,
    pub average_hourly_minor: i64,
    pub appointment_count: i64,
    pub completed_count: i64,
    pub payment_methods: Vec<PaymentMethodSummary>,
    pub points: Vec<RevenuePoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardSummary {
    pub today_settled_minor: i64,
    pub week_settled_minor: i64,
    pub pending_minor: i64,
    pub next_appointment: Option<Appointment>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_dtos_as_camel_case() {
        let snapshot = AccountSnapshot {
            account_name: "demo".into(),
            contact_name: None,
            server: None,
            character_name: None,
            specialization: None,
            gear_score: None,
        };

        let value = serde_json::to_value(snapshot).unwrap();
        assert_eq!(value["accountName"], "demo");
        assert!(value.get("account_name").is_none());
    }

    #[test]
    fn enum_wire_values_match_the_typescript_contract() {
        assert_eq!(
            serde_json::to_string(&ServiceStatus::InProgress).unwrap(),
            "\"in_progress\""
        );
        assert_eq!(SettlementStatus::NotApplicable.as_str(), "not_applicable");
    }
}
