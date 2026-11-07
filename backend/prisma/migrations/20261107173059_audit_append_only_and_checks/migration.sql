-- Журнал аудита: только добавление. UPDATE/DELETE/TRUNCATE запрещены на уровне БД.
CREATE OR REPLACE FUNCTION audit_log_forbid_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_forbid_change();

CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_forbid_change();

-- Email хранится в нижнем регистре
ALTER TABLE users ADD CONSTRAINT users_email_lower CHECK (email = lower(email));

-- Проверки значений
ALTER TABLE votes ADD CONSTRAINT votes_quorum_range CHECK (quorum_percent BETWEEN 0 AND 100);
ALTER TABLE vote_questions ADD CONSTRAINT vote_questions_choices CHECK (min_choices >= 0 AND max_choices >= min_choices);
ALTER TABLE dues ADD CONSTRAINT dues_amount_nonneg CHECK (amount_due >= 0);
ALTER TABLE dues_payments ADD CONSTRAINT dues_payments_amount_pos CHECK (amount > 0);
ALTER TABLE dues_settings ADD CONSTRAINT dues_settings_amount_nonneg CHECK (amount >= 0);
