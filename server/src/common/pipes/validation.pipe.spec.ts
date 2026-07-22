import { describe, it, expect, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { IsString, IsInt, Min } from 'class-validator';
import { ValidationPipe } from './validation.pipe';

class TestDto {
  @IsString()
  name!: string;

  @IsInt()
  @Min(0)
  age!: number;
}

describe('ValidationPipe', () => {
  let pipe: ValidationPipe;

  beforeEach(() => {
    pipe = new ValidationPipe();
  });

  it('should pass through when metatype is a primitive (String)', async () => {
    const value = 'hello';
    const result = await pipe.transform(value, {
      metatype: String,
      type: 'body',
    });
    expect(result).toBe('hello');
  });

  it('should pass through when metatype is a primitive (Number)', async () => {
    const value = 42;
    const result = await pipe.transform(value, {
      metatype: Number,
      type: 'body',
    });
    expect(result).toBe(42);
  });

  it('should pass through when metatype is a primitive (Boolean)', async () => {
    const value = true;
    const result = await pipe.transform(value, {
      metatype: Boolean,
      type: 'body',
    });
    expect(result).toBe(true);
  });

  it('should pass through when metatype is a primitive (Array)', async () => {
    const value = [1, 2, 3];
    const result = await pipe.transform(value, {
      metatype: Array,
      type: 'body',
    });
    expect(result).toEqual([1, 2, 3]);
  });

  it('should pass through when metatype is a primitive (Object)', async () => {
    const value = { foo: 'bar' };
    const result = await pipe.transform(value, {
      metatype: Object,
      type: 'body',
    });
    expect(result).toEqual({ foo: 'bar' });
  });

  it('should pass through when metatype is missing', async () => {
    const value = { name: 'Alice' };
    const result = await pipe.transform(value, {
      type: 'body',
    } as any);
    expect(result).toEqual({ name: 'Alice' });
  });

  it('should validate and transform a valid DTO', async () => {
    const value = { name: 'Alice', age: 25 };
    const result = await pipe.transform(value, {
      metatype: TestDto,
      type: 'body',
    });

    expect(result).toBeInstanceOf(TestDto);
    expect((result as TestDto).name).toBe('Alice');
    expect((result as TestDto).age).toBe(25);
  });

  it('should throw BadRequestException for invalid DTO', async () => {
    const value = { name: 123, age: -5 };

    await expect(
      pipe.transform(value, { metatype: TestDto, type: 'body' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should include constraint messages in the exception', async () => {
    const value = { name: 123, age: -5 };

    try {
      await pipe.transform(value, { metatype: TestDto, type: 'body' });
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      const response = (err as BadRequestException).getResponse() as any;
      expect(Array.isArray(response.message)).toBe(true);
      expect(response.message).toEqual(
        expect.arrayContaining([
          expect.stringContaining('name'),
          expect.stringContaining('age'),
        ]),
      );
    }
  });

  it('should throw BadRequestException for missing required fields', async () => {
    const value = {};

    await expect(
      pipe.transform(value, { metatype: TestDto, type: 'body' }),
    ).rejects.toThrow(BadRequestException);
  });
});