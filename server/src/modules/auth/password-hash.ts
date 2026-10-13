// Precomputed bcrypt hash of an arbitrary, non-secret string — never the
// hash of a real password. The compare target when no user is found, so
// login / step-up / social sign-in always pay bcrypt's cost: without it,
// "no such user" returns near-instantly while "wrong password" does not —
// a timing oracle that lets an attacker enumerate valid identifiers.
// One shared constant so the three sign-in paths cannot drift apart.
export const DUMMY_PASSWORD_HASH = '$2b$10$rGV9zEDpgnc/spXBlHqA9O5IjpBvndIyZE78fIhV8ZV4.5GAUfPJ.';
