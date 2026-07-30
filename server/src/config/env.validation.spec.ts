import "reflect-metadata";
import { describe, it, expect } from "vitest";
import { validate } from "./env.validation";

const validConfig = {
  DATABASE_URL: "postgres://postgres:postgres@localhost:5432/betonboi",
  JWT_SECRET: "a".repeat(32),
};

describe("env.validation", () => {
  it("accepts a config with all required fields present and valid", () => {
    expect(() => validate(validConfig)).not.toThrow();
  });

  it("rejects a missing JWT_SECRET", () => {
    const { JWT_SECRET: _omit, ...rest } = validConfig;
    expect(() => validate(rest)).toThrow();
  });

  it("rejects a JWT_SECRET shorter than 32 characters", () => {
    expect(() => validate({ ...validConfig, JWT_SECRET: "a".repeat(31) })).toThrow();
  });

  it("accepts a JWT_SECRET exactly 32 characters", () => {
    expect(() => validate({ ...validConfig, JWT_SECRET: "a".repeat(32) })).not.toThrow();
  });

  it("accepts NODE_ENV=development", () => {
    expect(() => validate({ ...validConfig, NODE_ENV: "development" })).not.toThrow();
  });

  it("accepts NODE_ENV=test", () => {
    expect(() => validate({ ...validConfig, NODE_ENV: "test" })).not.toThrow();
  });

  it("accepts NODE_ENV=production", () => {
    expect(() => validate({ ...validConfig, NODE_ENV: "production" })).not.toThrow();
  });

  it("rejects an unrecognized NODE_ENV", () => {
    expect(() => validate({ ...validConfig, NODE_ENV: "staging" })).toThrow();
  });

  it("accepts a missing NODE_ENV", () => {
    expect(() => validate(validConfig)).not.toThrow();
  });
});
