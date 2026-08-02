import { describe, it, expect } from "vitest";
import { BadRequestException, HttpException, HttpStatus, InternalServerErrorException } from "@nestjs/common";
import { ThrottlerException } from "@nestjs/throttler";
import { buildErrorResponseBody, resolveDetailMessage, resolveStatus } from "./error-response";

describe("resolveStatus", () => {
  it("returns the HttpException status", () => {
    expect(resolveStatus(new BadRequestException("bad"))).toBe(HttpStatus.BAD_REQUEST);
  });

  it("returns 500 for anything that is not an HttpException", () => {
    expect(resolveStatus(new Error("boom"))).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(resolveStatus("a string")).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(resolveStatus(null)).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
  });
});

describe("resolveDetailMessage", () => {
  it("returns HttpException.message for a plain string response", () => {
    expect(resolveDetailMessage(new BadRequestException("Validation failed"))).toBe("Validation failed");
  });

  // ValidationPipe's default exceptionFactory throws BadRequestException(stringArray).
  // HttpException.message would collapse that to "Bad Request Exception" — the
  // class-name fallback — losing every field-level validation error. Reading
  // getResponse().message instead preserves the real array.
  it("preserves an array-shaped message from getResponse(), where .message would collapse it", () => {
    const exception = new BadRequestException(["name should not be empty", "email must be an email"]);

    expect(exception.message).toBe("Bad Request Exception");
    expect(resolveDetailMessage(exception)).toEqual(["name should not be empty", "email must be an email"]);
  });

  it("falls back to HttpException.message when getResponse() has no message field", () => {
    const exception = new HttpException({ error: "no message field here" }, HttpStatus.BAD_REQUEST);

    expect(resolveDetailMessage(exception)).toBe(exception.message);
  });

  it("returns Error.message for a plain Error", () => {
    expect(resolveDetailMessage(new Error("db exploded"))).toBe("db exploded");
  });

  it("falls back to a generic message for non-Error throwables", () => {
    expect(resolveDetailMessage("a string")).toBe("Internal server error");
    expect(resolveDetailMessage(null)).toBe("Internal server error");
    expect(resolveDetailMessage(undefined)).toBe("Internal server error");
  });
});

describe("buildErrorResponseBody", () => {
  const opts = (nodeEnv: string | undefined) => ({ path: "/api/things", requestId: "req-1", nodeEnv });

  // Protects the public error-response contract: clients (the SPAs) rely on
  // 4xx messages to act on validation/auth/tenant errors, in every environment.
  it("passes 4xx messages through unchanged in production", () => {
    const body = buildErrorResponseBody(new BadRequestException("Invalid credentials"), opts("production"));

    expect(body.message).toBe("Invalid credentials");
    expect(body.stack).toBeUndefined();
  });

  it("passes 4xx messages through unchanged outside production", () => {
    const body = buildErrorResponseBody(new BadRequestException("Invalid credentials"), opts("development"));

    expect(body.message).toBe("Invalid credentials");
  });

  it("passes a ValidationPipe-style array message through as an array", () => {
    const exception = new BadRequestException(["name should not be empty", "email must be an email"]);

    const body = buildErrorResponseBody(exception, opts("production"));

    expect(body.message).toEqual(["name should not be empty", "email must be an email"]);
  });

  // 429 is a 4xx: the rate-limit guard's own Retry-After header carries the
  // machine-readable detail, so the body's message just needs to pass through.
  it("passes a ThrottlerException (429) message through in production", () => {
    const body = buildErrorResponseBody(new ThrottlerException(), opts("production"));

    expect(body.statusCode).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(body.message).toBe("ThrottlerException: Too Many Requests");
  });

  // Protects production data confidentiality: a wrapped TypeORM error or an
  // InternalServerErrorException(err.message) can carry a query fragment,
  // column name, or connection string — this must never reach the client.
  it("suppresses 5xx detail in production, with no stack", () => {
    const exception = new InternalServerErrorException(
      'duplicate key value violates unique constraint "users_email_key"',
    );

    const body = buildErrorResponseBody(exception, opts("production"));

    expect(body.message).toBe("Internal server error");
    expect(body.stack).toBeUndefined();
  });

  it("includes 5xx detail and stack outside production", () => {
    const exception = new InternalServerErrorException(
      'duplicate key value violates unique constraint "users_email_key"',
    );

    const body = buildErrorResponseBody(exception, opts("development"));

    expect(body.message).toBe('duplicate key value violates unique constraint "users_email_key"');
    expect(body.stack).toBe(exception.stack);
  });

  it("suppresses a raw Error (non-HttpException) 5xx in production", () => {
    const exception = new Error("connection to postgres://user:pass@host failed");

    const body = buildErrorResponseBody(exception, opts("production"));

    expect(body.message).toBe("Internal server error");
    expect(body.stack).toBeUndefined();
  });

  it("includes a raw Error's message and stack outside production", () => {
    const exception = new Error("connection to postgres://user:pass@host failed");

    const body = buildErrorResponseBody(exception, opts("development"));

    expect(body.message).toBe("connection to postgres://user:pass@host failed");
    expect(body.stack).toBe(exception.stack);
  });

  it("never attaches a stack for non-Error throwables, even outside production", () => {
    const body = buildErrorResponseBody("a string error", opts("development"));

    expect(body.message).toBe("Internal server error");
    expect(body.stack).toBeUndefined();
  });

  it("carries statusCode, timestamp, path, and requestId", () => {
    const body = buildErrorResponseBody(new HttpException("Forbidden", HttpStatus.FORBIDDEN), opts("production"));

    expect(body.statusCode).toBe(HttpStatus.FORBIDDEN);
    expect(body.path).toBe("/api/things");
    expect(body.requestId).toBe("req-1");
    expect(typeof body.timestamp).toBe("string");
    // new Date(invalid) returns an Invalid Date rather than throwing, so
    // Date.parse is the assertion that can actually fail on a bad string.
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
  });

  it("treats an undefined NODE_ENV as non-production", () => {
    const exception = new InternalServerErrorException("leaky detail");

    const body = buildErrorResponseBody(exception, opts(undefined));

    expect(body.message).toBe("leaky detail");
  });
});
