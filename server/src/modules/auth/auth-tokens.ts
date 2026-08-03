// DI token constants shared between auth.module.ts and the services/
// controllers it wires up. Kept in their own file (rather than defined on
// auth.module.ts and imported from there) to avoid a module <-> provider
// circular import.
export const ACCESS_TOKEN_TTL_MS = "ACCESS_TOKEN_TTL_MS";
