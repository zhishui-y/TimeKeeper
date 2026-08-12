-- Invalid legacy values cannot be scheduled safely. Preserve the appointment
-- and disable its reminder before enforcing the new boundary.
UPDATE appointments
SET reminder_minutes = NULL
WHERE reminder_minutes IS NOT NULL
  AND reminder_minutes NOT BETWEEN 0 AND 1440;

CREATE TRIGGER appointments_reminder_minutes_insert
BEFORE INSERT ON appointments
WHEN NEW.reminder_minutes IS NOT NULL
 AND NEW.reminder_minutes NOT BETWEEN 0 AND 1440
BEGIN
    SELECT RAISE(ABORT, 'reminder_minutes must be between 0 and 1440');
END;

CREATE TRIGGER appointments_reminder_minutes_update
BEFORE UPDATE OF reminder_minutes ON appointments
WHEN NEW.reminder_minutes IS NOT NULL
 AND NEW.reminder_minutes NOT BETWEEN 0 AND 1440
BEGIN
    SELECT RAISE(ABORT, 'reminder_minutes must be between 0 and 1440');
END;
