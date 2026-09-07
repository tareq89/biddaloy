import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Readable } from 'stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { StorageService, buildStorageConfig, type StorageConfig } from './storage.service';

const TEST_CONFIG: StorageConfig = {
  endpoint: 'http://localhost:9000',
  region: 'us-east-1',
  bucket: 'biddaloy-test',
  accessKeyId: 'test-key',
  secretAccessKey: 'test-secret',
  forcePathStyle: true,
};

describe('buildStorageConfig', () => {
  const validEnv = {
    S3_ENDPOINT: 'http://localhost:9000',
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'biddaloy',
    S3_ACCESS_KEY_ID: 'key',
    S3_SECRET_ACCESS_KEY: 'secret',
  };

  it('builds a config from a fully-populated env', () => {
    const config = buildStorageConfig(validEnv);
    expect(config.bucket).toBe('biddaloy');
    expect(config.forcePathStyle).toBe(false);
  });

  it('parses S3_FORCE_PATH_STYLE=true', () => {
    const config = buildStorageConfig({ ...validEnv, S3_FORCE_PATH_STYLE: 'true' });
    expect(config.forcePathStyle).toBe(true);
  });

  for (const missing of Object.keys(validEnv)) {
    it(`throws naming the missing variable when ${missing} is unset`, () => {
      const env = { ...validEnv };
      delete (env as Record<string, string | undefined>)[missing];
      expect(() => buildStorageConfig(env)).toThrow(new RegExp(missing));
    });
  }
});

describe('StorageService', () => {
  let service: StorageService;
  let send: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    service = new StorageService(TEST_CONFIG);
    send = vi.fn();
    // Reach into the private client field — a mocked S3Client.send is the
    // ticket's prescribed test approach, no live bucket required.
    (service as unknown as { client: { send: typeof send } }).client = { send };
  });

  it('put() sends a PutObjectCommand with the given key/body/contentType', async () => {
    send.mockResolvedValueOnce({});
    const body = Buffer.from('hello');
    await service.put('tenants/t1/avatars/a.png', body, 'image/png');

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: 'biddaloy-test',
      Key: 'tenants/t1/avatars/a.png',
      Body: body,
      ContentType: 'image/png',
    });
  });

  it('put() propagates errors from the client', async () => {
    send.mockRejectedValueOnce(new Error('network down'));
    await expect(service.put('k', Buffer.from('x'), 'text/plain')).rejects.toThrow(
      'network down',
    );
  });

  it('get() sends a GetObjectCommand and returns body/contentType', async () => {
    const body = Readable.from(['data']);
    send.mockResolvedValueOnce({ Body: body, ContentType: 'image/png' });

    const result = await service.get('tenants/t1/avatars/a.png');

    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(GetObjectCommand);
    expect(command.input).toMatchObject({ Bucket: 'biddaloy-test', Key: 'tenants/t1/avatars/a.png' });
    expect(result.body).toBe(body);
    expect(result.contentType).toBe('image/png');
  });

  it('get() propagates errors from the client', async () => {
    send.mockRejectedValueOnce(new Error('not found'));
    await expect(service.get('missing')).rejects.toThrow('not found');
  });

  it('delete() sends a DeleteObjectCommand', async () => {
    send.mockResolvedValueOnce({});
    await service.delete('tenants/t1/avatars/a.png');

    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(DeleteObjectCommand);
    expect(command.input).toMatchObject({ Bucket: 'biddaloy-test', Key: 'tenants/t1/avatars/a.png' });
  });

  it('delete() propagates errors from the client', async () => {
    send.mockRejectedValueOnce(new Error('boom'));
    await expect(service.delete('k')).rejects.toThrow('boom');
  });

  it('exists() sends a HeadObjectCommand and returns true when it resolves', async () => {
    send.mockResolvedValueOnce({});
    const result = await service.exists('tenants/t1/avatars/a.png');

    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(HeadObjectCommand);
    expect(result).toBe(true);
  });

  it('exists() returns false on a NotFound error', async () => {
    const error = Object.assign(new Error('not found'), { name: 'NotFound' });
    send.mockRejectedValueOnce(error);
    await expect(service.exists('missing')).resolves.toBe(false);
  });

  it('exists() returns false on a 404 status code without the NotFound name', async () => {
    const error = Object.assign(new Error('not found'), {
      $metadata: { httpStatusCode: 404 },
    });
    send.mockRejectedValueOnce(error);
    await expect(service.exists('missing')).resolves.toBe(false);
  });

  it('exists() propagates a non-404 error', async () => {
    const error = Object.assign(new Error('access denied'), {
      $metadata: { httpStatusCode: 403 },
    });
    send.mockRejectedValueOnce(error);
    await expect(service.exists('k')).rejects.toThrow('access denied');
  });
});
