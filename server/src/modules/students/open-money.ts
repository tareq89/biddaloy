import { FeeStatus } from '@biddaloy/shared';
import type { EntityManager } from 'typeorm';

/** Bills a student can still pay: the set checkout and payment allocation accept. */
export const PAYABLE_FEE_STATUSES: readonly string[] = [
  FeeStatus.PENDING,
  FeeStatus.PARTIALLY_PAID,
  FeeStatus.OVERDUE,
];

export interface StudentOpenMoney {
  id: string;
  full_name: string;
  registration_number: string;
  open_dues: number;
  wallet_balance: number;
}

/**
 * The students among `studentIds` who still owe money or hold wallet money,
 * i.e. the ones `StudentService.remove` refuses to delete. Read only, takes
 * no locks; a restore runs this while the school is frozen for writes.
 */
export async function studentsWithOpenMoney(
  m: EntityManager,
  tenantId: string,
  studentIds: string[],
): Promise<StudentOpenMoney[]> {
  const rows = (await m.query(
    `SELECT st.id, st.full_name, st.registration_number,
            COALESCE(d.open_dues, 0) AS open_dues, COALESCE(w.balance, 0) AS wallet_balance
       FROM students st
       LEFT JOIN (
         SELECT sf.student_id, SUM(sf.total_amount - sf.paid_amount - sf.discount_amount) AS open_dues
           FROM student_fees sf
           -- student_fees has no tenant_id: scope it through its student.
           JOIN students fs ON fs.id = sf.student_id AND fs.tenant_id = $1
          WHERE sf.student_id = ANY($2) AND sf.deleted_at IS NULL AND sf.status::text = ANY($3)
          GROUP BY sf.student_id
       ) d ON d.student_id = st.id
       LEFT JOIN student_wallets w ON w.student_id = st.id AND w.tenant_id = st.tenant_id
      WHERE st.tenant_id = $1 AND st.id = ANY($2)
        AND (COALESCE(d.open_dues, 0) > 0 OR COALESCE(w.balance, 0) <> 0)
      ORDER BY st.registration_number`,
    [tenantId, studentIds, PAYABLE_FEE_STATUSES],
  )) as Array<Omit<StudentOpenMoney, 'open_dues' | 'wallet_balance'> & Record<string, string>>;
  return rows.map((r) => ({
    id: r.id,
    full_name: r.full_name,
    registration_number: r.registration_number,
    open_dues: Number(r.open_dues),
    wallet_balance: Number(r.wallet_balance),
  }));
}
