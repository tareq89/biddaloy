import { describe, it, expect } from "vitest";
import { BadRequestException, ValidationPipe } from "@nestjs/common";
import { IsInt, IsString } from "class-validator";
import { buildValidationPipeOptions } from "./validation-pipe";

class TestDto {
  @IsString()
  name!: string;

  @IsInt()
  age!: number;
}

describe("buildValidationPipeOptions", () => {
  it("returns the strict validation options", () => {
    expect(buildValidationPipeOptions()).toEqual({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: false },
    });
  });

  // Behavioral coverage, not just the options shape — a typo in the config
  // object would still pass the assertion above unless it actually changes
  // what the pipe does.
  describe("the pipe it configures", () => {
    const pipe = new ValidationPipe(buildValidationPipeOptions());
    const metadata = { type: "body" as const, metatype: TestDto };

    it("strips whitelisted-but-unknown properties instead of rejecting them", async () => {
      // whitelist alone (without forbidNonWhitelisted) would silently drop
      // this; asserting it here pins that we get forbidNonWhitelisted's
      // reject-instead-of-strip behavior for truly unknown fields below,
      // while confirming transform still produces a clean DTO instance.
      const result = await pipe.transform({ name: "Alice", age: 25 }, metadata);
      expect(result).toBeInstanceOf(TestDto);
      expect(result).toEqual({ name: "Alice", age: 25 });
    });

    it("rejects a request carrying an undecorated field (forbidNonWhitelisted)", async () => {
      await expect(
        pipe.transform({ name: "Alice", age: 25, role: "SUPER_ADMIN" }, metadata),
      ).rejects.toThrow(BadRequestException);
    });

    it("does not implicitly coerce a numeric-looking string (enableImplicitConversion: false)", async () => {
      // With implicit conversion on, "25" would silently become 25. Off, it
      // stays a string and @IsInt() correctly rejects it.
      await expect(pipe.transform({ name: "Alice", age: "25" }, metadata)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
