import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ChangePasswordDto } from './change-password.dto';

async function messagesFor(payload: Record<string, unknown>): Promise<string[]> {
  const errors = await validate(plainToInstance(ChangePasswordDto, payload));
  return errors.map((err) => err.property);
}

describe('ChangePasswordDto', () => {
  it('passes when both passwords are present', async () => {
    expect(await messagesFor({ current_password: 'old-pass', new_password: 'new-pass' })).toEqual(
      [],
    );
  });

  it('fails when current_password is missing', async () => {
    expect(await messagesFor({ new_password: 'new-pass' })).toContain('current_password');
  });

  it('fails when new_password is missing', async () => {
    expect(await messagesFor({ current_password: 'old-pass' })).toContain('new_password');
  });

  it('fails when either password is an empty string', async () => {
    const properties = await messagesFor({ current_password: '', new_password: '' });
    expect(properties).toContain('current_password');
    expect(properties).toContain('new_password');
  });

  it('fails when a password is not a string', async () => {
    expect(await messagesFor({ current_password: 12345, new_password: 'new-pass' })).toContain(
      'current_password',
    );
  });
});
