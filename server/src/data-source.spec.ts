import { describe, it, expect, beforeAll } from 'vitest';
import { DataSource } from 'typeorm';

describe('data-source', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    // Set DATABASE_URL before import so the module-level DataSource gets it
    process.env.DATABASE_URL =
      process.env.DATABASE_URL || 'postgresql://localhost:5432/test';
    const mod = await import('./data-source');
    dataSource = mod.default;
  });

  it('should export a DataSource instance', () => {
    expect(dataSource).toBeInstanceOf(DataSource);
  });

  it('should have postgres as the database type', () => {
    expect(dataSource.options.type).toBe('postgres');
  });

  it('should have synchronize set to false', () => {
    expect(dataSource.options.synchronize).toBe(false);
  });

  it('should have a migrationsTableName', () => {
    expect(dataSource.options.migrationsTableName).toBe('typeorm_migrations');
  });

  it('should have a DATABASE_URL configured', () => {
    const opts = dataSource.options as any;
    expect(opts.url).toBe(
      process.env.DATABASE_URL || 'postgresql://localhost:5432/test',
    );
  });

  it('should include entity and migration patterns', () => {
    const opts = dataSource.options as any;
    expect(opts.entities).toBeDefined();
    expect(Array.isArray(opts.entities)).toBe(true);
    expect(opts.entities.length).toBeGreaterThan(0);

    expect(opts.migrations).toBeDefined();
    expect(Array.isArray(opts.migrations)).toBe(true);
    expect(opts.migrations.length).toBeGreaterThan(0);
  });
});