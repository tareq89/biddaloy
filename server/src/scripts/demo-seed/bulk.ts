import type { ObjectLiteral, Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

/** Bulk insert in chunks (D38): one INSERT per chunk, bypassing entity hooks. Returns rows written. */
export async function insertChunked<T extends ObjectLiteral>(
  repo: Repository<T>,
  rows: QueryDeepPartialEntity<T>[],
  chunkSize = 1000,
): Promise<number> {
  for (let i = 0; i < rows.length; i += chunkSize) {
    await repo
      .createQueryBuilder()
      .insert()
      .values(rows.slice(i, i + chunkSize))
      .execute();
  }
  return rows.length;
}
