import { Brackets, SelectQueryBuilder } from 'typeorm';
import { endOfLocalDay, startOfLocalDay } from '../../common/time';
import { normalizeSearchTerm } from '../../common/utils/normalize-search-term.util';
import { CommunicationLog } from './entities/communication-log.entity';
import { QueryCommunicationLogsDto } from './dto/reminders.dto';

/**
 * [3343] The message log's WHERE clauses, shared by every route that lists logs. The caller has
 * already scoped the query to the tenant (`log.tenant_id`); every value here is a bound
 * parameter (Rule 4).
 */
export function applyMessageLogFilters(
  qb: SelectQueryBuilder<CommunicationLog>,
  query: QueryCommunicationLogsDto,
): void {
  if (query.student_id) qb.andWhere('log.student_id = :studentId', { studentId: query.student_id });
  if (query.guardian_id) {
    qb.andWhere('log.guardian_id = :guardianId', { guardianId: query.guardian_id });
  }
  if (query.status) qb.andWhere('log.status = :status', { status: query.status });
  if (query.trigger) qb.andWhere('log.trigger = :trigger', { trigger: query.trigger });
  if (query.sent_by) qb.andWhere('log.sent_by_user_id = :sentBy', { sentBy: query.sent_by });
  if (query.provider) {
    qb.andWhere(`log.metadata ->> 'provider' = :provider`, { provider: query.provider });
  }
  // School-local days (IsRealDate: always YYYY-MM-DD), the same days the
  // Failed messages widget counts with, so its link lands on the same rows.
  if (query.from_date) {
    qb.andWhere('log.created_at >= :from', { from: startOfLocalDay(query.from_date) });
  }
  if (query.to_date) {
    qb.andWhere('log.created_at <= :to', { to: endOfLocalDay(query.to_date) });
  }
  const search = normalizeSearchTerm(query.search);
  if (search) {
    // D33: a phone-shaped term also matches by digits with the country code dropped, so
    // `+880 1712-345678`, `8801712345678` and `01712 345678` all find `01712345678`.
    // ponytail: no trigram index; add pg_trgm when a school passes 100k logs.
    const digits = /^[\d\s+()-]+$/.test(search) ? search.replace(/\D/g, '') : '';
    // Only the country code `880` (`8801…` -> `01…`), not any leading `88`.
    const local = digits.startsWith('880') ? digits.slice(2) : digits;
    // At least 4 digits: `880` alone would become `0` and match nearly every number.
    const phone = local.length >= 4 ? local : '';
    qb.andWhere(
      new Brackets((w) => {
        w.where('log.recipient_name ILIKE :search', { search: `%${search}%` }).orWhere(
          'log.recipient_address ILIKE :search',
        );
        if (phone) w.orWhere('log.recipient_address ILIKE :phone', { phone: `%${phone}%` });
      }),
    );
  }
}
