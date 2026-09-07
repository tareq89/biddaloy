-- Post-restore integrity check. Run against a freshly restored + migrated
-- database: `psql "$TARGET_DATABASE_URL" -f scripts/backup/verify.sql`
--
-- Prints one row per table with its total row count and its distinct
-- tenant_id count (for tables that carry a tenant_id — a table without one
-- prints NULL there rather than erroring, so this stays a single query
-- that runs unmodified as the schema grows).
--
-- `invoices` has no tenant_id column of its own (see server/src/modules/
-- invoices/entities/invoice.entity.ts) — tenancy is inherited through
-- student_id, so its tenant count is derived via a join to students
-- instead of read directly off the table.
select 'schools' as table_name, count(*) as row_count, count(distinct id) as distinct_tenant_count from schools
union all
select 'users', count(*), null from users
union all
select 'memberships (user_tenants)', count(*), count(distinct tenant_id) from user_tenants
union all
select 'students', count(*), count(distinct tenant_id) from students
union all
select 'invoices', count(*), count(distinct s.tenant_id)
  from invoices i join students s on s.id = i.student_id
union all
select 'payments', count(*), count(distinct tenant_id) from payments
union all
select 'audit_logs', count(*), count(distinct tenant_id) from audit_logs
union all
select 'communication_logs', count(*), count(distinct tenant_id) from communication_logs
order by table_name;

-- logo_key values, one per line, so the operator can spot-check that each
-- referenced storage object still exists in the bucket (15.3.4 automates
-- this check). schools.logo_key doesn't exist yet as of [15.3.1]-[15.3.3]
-- (StorageService serves consumers, but nothing has wired a school logo
-- upload to it yet — that's a later ticket, [15.5.4]) — this block is a
-- no-op today and starts printing real keys the moment that column lands,
-- with no further changes needed here.
do $$
declare
  keys text;
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'schools' and column_name = 'logo_key'
  ) then
    select string_agg(logo_key, e'\n') into keys from schools where logo_key is not null;
    raise notice 'schools.logo_key values:%', coalesce(e'\n' || keys, ' (none set)');
  else
    raise notice 'schools.logo_key does not exist yet (added in a later ticket) — skipping.';
  end if;
end $$;
