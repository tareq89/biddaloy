-- Staging scrub (Epic 79, #2793, decisions D6 and D20). Run by staging-refresh.sh on the
-- restored copy `biddaloy_staging_next`, never on production:
--
--   psql -1 -v ON_ERROR_STOP=1 -v staging_password_hash=... -v smoke_slug=... \
--        -v platform_tenant_id=... -f scrub.sql
--
-- `-1` wraps the whole file in ONE transaction, so there is no BEGIN/COMMIT here; a failed
-- statement rolls everything back. server/test/staging-scrub.integration.spec.ts runs this exact
-- file inside a transaction it rolls back.
--
-- Rules:
--   * Every statement names its table and columns. No dynamic SQL.
--   * Every personal-data column is listed in server/test/staging-scrub-columns.ts. That spec
--     fails when a new column that may hold personal data is not in the list.
--   * Fake values come from the row id, so they are stable and unique, and they carry no
--     original value. Free text becomes NULL, or '[scrubbed]' where the column is NOT NULL.
--   * Nothing here prints data.
--   * ponytail: fake phones use 9 digits of an md5, so two rows could collide once a table has
--     tens of thousands of rows with a unique phone index. The restore would fail loudly (the
--     transaction rolls back). Lengthen the digits if it ever happens.

-- Users whose email stays: platform super admins (D6) and users of the smoke school (D20).
CREATE TEMP TABLE scrub_keep_email ON COMMIT DROP AS
SELECT DISTINCT ut.user_id AS id
FROM user_tenants ut
WHERE ut.deleted_at IS NULL
  AND ((ut.tenant_id = :'platform_tenant_id'::uuid AND ut.role = 'SUPER_ADMIN')
       OR ut.tenant_id IN (SELECT s.id FROM schools s WHERE s.slug = :'smoke_slug'));

-- Smoke school users are test accounts and keep their name and phone too.
CREATE TEMP TABLE scrub_keep_all ON COMMIT DROP AS
SELECT DISTINCT ut.user_id AS id
FROM user_tenants ut
WHERE ut.deleted_at IS NULL
  AND ut.tenant_id IN (SELECT s.id FROM schools s WHERE s.slug = :'smoke_slug');

-- Contacts and names ------------------------------------------------------------------------

UPDATE users SET email = 'u-' || left(id::text, 8) || '@staging.invalid'
WHERE email IS NOT NULL AND id NOT IN (SELECT id FROM scrub_keep_email);

UPDATE users SET
  phone = '+8801' || lpad(((('x' || substr(md5(id::text), 1, 8))::bit(32)::bigint) % 1000000000)::text, 9, '0'),
  full_name = 'Person ' || left(id::text, 4),
  profile_picture_url = NULL
WHERE id NOT IN (SELECT id FROM scrub_keep_all);

UPDATE guardians SET
  full_name = 'Person ' || left(id::text, 4),
  phone = CASE WHEN phone IS NULL THEN NULL
    ELSE '+8801' || lpad(((('x' || substr(md5(id::text), 1, 8))::bit(32)::bigint) % 1000000000)::text, 9, '0') END,
  email = CASE WHEN email IS NULL THEN NULL ELSE 'g-' || left(id::text, 8) || '@staging.invalid' END,
  alternate_phone = CASE WHEN alternate_phone IS NULL THEN NULL
    ELSE '+8801' || lpad(((('x' || substr(md5(id::text || 'alt'), 1, 8))::bit(32)::bigint) % 1000000000)::text, 9, '0') END,
  address = CASE WHEN address IS NULL THEN NULL ELSE 'Address ' || left(id::text, 4) END,
  occupation = NULL;

UPDATE students SET
  full_name = 'Person ' || left(id::text, 4),
  full_name_bn = NULL,
  home_address = CASE WHEN home_address IS NULL THEN NULL ELSE 'Address ' || left(id::text, 4) END,
  birth_reg_no = NULL,
  father_name = CASE WHEN father_name IS NULL THEN NULL ELSE 'Father ' || left(id::text, 4) END,
  mother_name = CASE WHEN mother_name IS NULL THEN NULL ELSE 'Mother ' || left(id::text, 4) END,
  health_notes = NULL,
  photo_key = NULL;

UPDATE admission_applicants SET
  applicant_name = 'Person ' || left(id::text, 4),
  guardian_name = 'Person ' || left(id::text, 4),
  guardian_phone = '+8801' || lpad(((('x' || substr(md5(id::text), 1, 8))::bit(32)::bigint) % 1000000000)::text, 9, '0'),
  guardian_email = CASE WHEN guardian_email IS NULL THEN NULL ELSE 'a-' || left(id::text, 8) || '@staging.invalid' END,
  home_address = CASE WHEN home_address IS NULL THEN NULL ELSE 'Address ' || left(id::text, 4) END,
  documents = '[]'::jsonb;

UPDATE applications SET
  applicant_name = CASE WHEN applicant_name IS NULL THEN NULL ELSE 'Person ' || left(id::text, 4) END,
  letter_text = '[scrubbed]',
  payload = '{}'::jsonb,
  granted = NULL,
  effect_result = NULL;
UPDATE application_events SET note = NULL, data = NULL;
UPDATE application_attachments SET file_name = 'file-' || left(id::text, 8);

DELETE FROM user_identities;

UPDATE schools SET
  phone = CASE WHEN phone IS NULL THEN NULL
    ELSE '+8801' || lpad(((('x' || substr(md5(id::text), 1, 8))::bit(32)::bigint) % 1000000000)::text, 9, '0') END,
  email = CASE WHEN email IS NULL THEN NULL ELSE 's-' || left(id::text, 8) || '@staging.invalid' END,
  address = CASE WHEN address IS NULL THEN NULL ELSE 'Address ' || left(id::text, 4) END
WHERE id <> :'platform_tenant_id'::uuid;
UPDATE schools SET status_reason = NULL;

UPDATE staff_family_members SET
  name = 'Person ' || left(id::text, 4),
  contact = CASE WHEN contact IS NULL THEN NULL
    ELSE '+8801' || lpad(((('x' || substr(md5(id::text), 1, 8))::bit(32)::bigint) % 1000000000)::text, 9, '0') END,
  occupation = NULL;
UPDATE staff_addresses SET district = NULL, post_office = NULL, upazila = NULL, village_street = NULL;
UPDATE staff_hr_records SET name_bn = NULL, index_no = NULL, salary_code = NULL, salary_scale = NULL;
UPDATE staff_achievements SET description = NULL;
UPDATE staff_experience SET description = NULL;
UPDATE staff_designation_history SET notes = NULL;
UPDATE staff_incidents SET body = '[scrubbed]', withdraw_reason = NULL;
UPDATE staff_documents SET original_filename = 'file-' || left(id::text, 8);
UPDATE print_assets SET original_name = 'file-' || left(id::text, 8);

-- School provider secrets (paths from TenantSettingsDto @Secret()) and SMTP identity -------------

UPDATE schools SET settings = jsonb_set(jsonb_set(
    settings
      #- '{communications,sms,greenweb,apiKey}'
      #- '{communications,sms,mimsms,apiKey}'
      #- '{communications,whatsapp,accessToken}'
      #- '{communications,email,password}'
      #- '{communications,messenger,accessToken}',
    '{communications,email,user}', '"scrubbed@staging.invalid"'::jsonb, false),
    '{communications,email,from}', '"scrubbed@staging.invalid"'::jsonb, false)
WHERE settings IS NOT NULL;

-- Tokens, sessions, devices -----------------------------------------------------------------

DELETE FROM refresh_tokens;
DELETE FROM auth_tokens;
DELETE FROM calendar_feed_tokens;
DELETE FROM invoice_share_tokens;
DELETE FROM push_subscriptions;
DELETE FROM attendance_device_events;
DELETE FROM attendance_devices;
-- verify_token_hash is CHAR(64) NOT NULL UNIQUE, so it cannot be NULL: 64 hex chars from the id.
UPDATE print_job_items SET
  verify_token_hash = md5(id::text) || md5(reverse(id::text)),
  data_snapshot = '{}'::jsonb,
  subject_label = 'Person ' || left(id::text, 4),
  revoke_reason = NULL;

-- Passwords: every user gets the same staging password ----------------------------------------

UPDATE users SET password_hash = :'staging_password_hash';

-- Messages: nothing queued can ever be sent, and bodies and recipients are gone ----------------

UPDATE communication_logs SET
  message_body = '[scrubbed]',
  recipient_address = 'scrubbed',
  recipient_name = 'scrubbed',
  subject = NULL,
  provider_message_id = NULL,
  metadata = NULL,
  status = CASE WHEN status = 'QUEUED' THEN 'FAILED' ELSE status END;
UPDATE reminder_batches SET message_template = NULL;
UPDATE alerts SET manual_body = NULL, params = params - 'studentName';

-- Free text about people ----------------------------------------------------------------------

UPDATE acr_assessments SET step1_data = NULL, step3_data = NULL;
UPDATE admission_evaluations SET notes = '[scrubbed]';
UPDATE attendance_records SET remarks = NULL;
UPDATE invoices SET notes = NULL;
UPDATE leave_records SET reason = NULL;
UPDATE lesson_deliveries SET note = NULL;
UPDATE milestone_achievements SET remark = NULL;
UPDATE payment_allocations SET notes = NULL;
UPDATE payments SET remarks = NULL, reversal_reason = NULL, issuer_snapshot = NULL;
UPDATE promotion_entries SET override_note = NULL;
UPDATE routine_change_requests SET note = '[scrubbed]', resolution_note = NULL;
UPDATE routine_substitutions SET reason = NULL;
UPDATE student_fees SET note = NULL;
UPDATE student_lifecycle_events SET reason = '[scrubbed]', remark = NULL;
UPDATE student_notes SET body = '[scrubbed]';
UPDATE homework_submissions SET attachments = '[]'::jsonb;
UPDATE seat_orders SET receipt_snapshot = NULL;
UPDATE platform_payments SET raw = NULL;

-- Append-only tables: their write-block triggers are lifted inside this transaction only. -------

ALTER TABLE wallet_transactions DISABLE TRIGGER trg_wallet_transactions_write_only;
UPDATE wallet_transactions SET note = NULL;
ALTER TABLE wallet_transactions ENABLE TRIGGER trg_wallet_transactions_write_only;

ALTER TABLE audit_logs DISABLE TRIGGER trg_audit_logs_write_only;
UPDATE audit_logs SET old_values = NULL, new_values = NULL, ip_address = NULL, user_agent = NULL;
ALTER TABLE audit_logs ENABLE TRIGGER trg_audit_logs_write_only;

-- The invoice snapshot is frozen by trigger; rewrite it without names, contacts or issuer details.
ALTER TABLE invoices DISABLE TRIGGER trg_enforce_invoice_immutability;
UPDATE invoices SET
  issuer_snapshot = NULL,
  snapshot = jsonb_set(jsonb_set(jsonb_set(snapshot,
      '{issuer}', jsonb_build_object('name', 'Staging School', 'name_bn', NULL, 'address', NULL,
        'phone', NULL, 'email', NULL, 'registration_id', NULL, 'logo_key', NULL,
        'captured_at', snapshot #> '{issuer,captured_at}')),
      '{students}', COALESCE((
        SELECT jsonb_agg(st || jsonb_build_object('full_name', 'Person ' || left(st ->> 'id', 4)))
        FROM jsonb_array_elements(COALESCE(snapshot -> 'students', '[]'::jsonb)) st), '[]'::jsonb)),
      '{payment}', COALESCE(snapshot -> 'payment', '{}'::jsonb)
        || jsonb_build_object('reference', NULL, 'received_by_name', NULL));
ALTER TABLE invoices ENABLE TRIGGER trg_enforce_invoice_immutability;
