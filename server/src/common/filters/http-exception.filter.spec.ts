import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import { AllExceptionsFilter } from './http-exception.filter';

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let mockJson: ReturnType<typeof vi.fn>;
  let mockStatus: ReturnType<typeof vi.fn>;
  let mockResponse: any;
  let mockRequest: any;
  let mockHost: any;

  beforeEach(() => {
    filter = new AllExceptionsFilter();

    mockJson = vi.fn();
    mockStatus = vi.fn().mockReturnValue({ json: mockJson });
    mockResponse = { status: mockStatus };
    mockRequest = { method: 'GET', url: '/test' };
    mockHost = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
    };

    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should handle HttpException with its status and message', () => {
    const exception = new HttpException('Not found', HttpStatus.NOT_FOUND);

    filter.catch(exception, mockHost);

    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.NOT_FOUND,
        message: 'Not found',
        path: '/test',
      }),
    );
  });

  it('should handle BadRequestException (400)', () => {
    const { BadRequestException } = require('@nestjs/common');
    const exception = new BadRequestException('Validation failed');

    filter.catch(exception, mockHost);

    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Validation failed',
      }),
    );
  });

  it('should handle non-HTTP Error with 500 and "Internal server error"', () => {
    const exception = new Error('Something broke');

    filter.catch(exception, mockHost);

    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Internal server error',
      }),
    );
  });

  it('should handle non-Error exceptions (e.g. string) with 500', () => {
    const exception = 'some string error';

    filter.catch(exception, mockHost);

    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Internal server error',
      }),
    );
  });

  it('should handle null/undefined exception with 500', () => {
    filter.catch(null, mockHost);

    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Internal server error',
      }),
    );
  });

  it('should include timestamp and path in the response body', () => {
    const exception = new HttpException('Forbidden', HttpStatus.FORBIDDEN);

    filter.catch(exception, mockHost);

    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.FORBIDDEN,
        message: 'Forbidden',
        path: '/test',
      }),
    );

    const callArg = mockJson.mock.calls[0][0];
    expect(callArg).toHaveProperty('timestamp');
    expect(typeof callArg.timestamp).toBe('string');
    expect(() => new Date(callArg.timestamp)).not.toThrow();
  });

  it('should log the error with method, URL, status, and message', () => {
    const exception = new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    mockRequest.method = 'POST';
    mockRequest.url = '/api/auth';

    filter.catch(exception, mockHost);

    expect(Logger.prototype.error).toHaveBeenCalledWith(
      'POST /api/auth → 401: Unauthorized',
      expect.any(String),
    );
  });

  it('should log the stack trace for Error instances', () => {
    const exception = new Error('Database connection failed');
    const stack = exception.stack;

    filter.catch(exception, mockHost);

    expect(Logger.prototype.error).toHaveBeenCalledWith(
      'GET /test → 500: Internal server error',
      stack,
    );
  });

  it('should handle HttpException with status code 500', () => {
    const exception = new HttpException(
      'Internal error',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );

    filter.catch(exception, mockHost);

    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Internal error',
      }),
    );
  });

  it('should handle HttpException with object response', () => {
    const exception = new HttpException(
      { message: 'Custom error', error: 'bad request' },
      HttpStatus.BAD_REQUEST,
    );

    filter.catch(exception, mockHost);

    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    // HttpException.message returns the `message` field from the object response
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Custom error',
      }),
    );
  });
});