import { describe, it, expect } from 'vitest';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ProvisionSchoolDto } from './provision-school.dto';
import { AddSchoolAdminDto } from '../../admins/dto/add-school-admin.dto';

const VALID_KEY = '3f2504e0-4f89-4d3a-9a0c-0305e82c3301';

describe('ProvisionSchoolDto', () => {
  it('rejects a body with no admin object at all (400, not a 500 inside the transaction)', async () => {
    const dto = plainToInstance(ProvisionSchoolDto, {
      name: 'Green Valley',
      slug: 'green-valley',
      idempotency_key: VALID_KEY,
    });

    const errors = await validate(dto);
    expect(errors.find((e) => e.property === 'admin')?.constraints?.isDefined).toBeDefined();
  });

  it('rejects an admin with only a name — no email or phone to deliver the invitation to', async () => {
    const dto = plainToInstance(ProvisionSchoolDto, {
      name: 'Green Valley',
      slug: 'green-valley',
      admin: { name: 'Admin One' },
      idempotency_key: VALID_KEY,
    });

    const errors = await validate(dto);
    const adminError = errors.find((e) => e.property === 'admin');
    const nameError = adminError?.children?.find((c) => c.property === 'name');
    expect(nameError?.constraints?.hasAdminContact).toBeDefined();
  });

  it('treats a whitespace-only phone as missing', async () => {
    const dto = plainToInstance(ProvisionSchoolDto, {
      name: 'Green Valley',
      slug: 'green-valley',
      admin: { name: 'Admin One', phone: '   ' },
      idempotency_key: VALID_KEY,
    });

    const errors = await validate(dto);
    const adminError = errors.find((e) => e.property === 'admin');
    const nameError = adminError?.children?.find((c) => c.property === 'name');
    expect(nameError?.constraints?.hasAdminContact).toBeDefined();
  });

  it('accepts an admin with an email', async () => {
    const dto = plainToInstance(ProvisionSchoolDto, {
      name: 'Green Valley',
      slug: 'green-valley',
      admin: { name: 'Admin One', email: 'admin@example.com' },
      idempotency_key: VALID_KEY,
    });

    expect(await validate(dto)).toEqual([]);
  });

  it('accepts an admin with only a phone', async () => {
    const dto = plainToInstance(ProvisionSchoolDto, {
      name: 'Green Valley',
      slug: 'green-valley',
      admin: { name: 'Admin One', phone: '01712345678' },
      idempotency_key: VALID_KEY,
    });

    expect(await validate(dto)).toEqual([]);
  });
});

describe('AddSchoolAdminDto', () => {
  // Same class hierarchy as the nested `admin` above, so the same
  // email-or-phone rule applies to `POST /schools/:id/admins`.
  it('rejects a name-only body', async () => {
    const errors = await validate(plainToInstance(AddSchoolAdminDto, { name: 'Admin One' }));
    expect(errors.find((e) => e.property === 'name')?.constraints?.hasAdminContact).toBeDefined();
  });

  it('accepts a name plus email', async () => {
    const errors = await validate(
      plainToInstance(AddSchoolAdminDto, { name: 'Admin One', email: 'admin@example.com' }),
    );
    expect(errors).toEqual([]);
  });
});
