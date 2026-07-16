# @beton-boi/shared — Shared Types & Enums

TypeScript enums, types, and DTOs shared between the server and client packages. This package ensures type consistency across the monorepo.

## What's Here

| Directory | Contents |
|-----------|----------|
| `src/enums/` | Domain enums: `UserRole`, `UserStatus`, `FeeType`, `FeeStatus`, `PaymentMethod`, `PaymentStatus`, `InvoiceStatus`, `CommunicationStatus`, `AuditAction`, `EnrollmentStatus`, `TeacherDesignation`, and more |
| `src/types/` | Shared TypeScript interfaces (planned) |
| `src/dto/` | Shared DTO validation classes (planned) |

## Usage

Any package in the monorepo can import from `@beton-boi/shared`:

```typescript
import { UserRole, UserStatus } from '@beton-boi/shared';
```

The server's `tsconfig.json` resolves it via yarn workspace symlinks. The client-student Vite config resolves it via a direct alias to `../shared/src`.

## Commands

| Command | Description |
|---------|-------------|
| `build` | Compile TypeScript to `dist/` (`tsc`) |
| `build:watch` | Watch mode (`tsc --watch`) |

## Development

```bash
# Build once (required before consuming in other packages)
yarn workspace @beton-boi/shared build

# Watch mode during development
yarn workspace @beton-boi/shared build:watch
```

The `shared` package must be built **before** the server or client can import it. The `build:all` script at the root handles this automatically.

## Adding a New Enum or Type

1. Create the file in the appropriate directory under `src/`
2. Export it from `src/index.ts` (barrel export)
3. Run `yarn workspace @beton-boi/shared build` to update `dist/`

## Note

The `dist/` directory is committed to the repo (or built as part of the deploy pipeline). The compiled JS files in `dist/` are what other packages actually import at runtime.