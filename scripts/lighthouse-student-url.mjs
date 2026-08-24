#!/usr/bin/env node
/**
 * Resolves a seeded student's detail URL for the lighthouse job (#149):
 * logs in as the seeded admin, lists students in the first tenant
 * membership, prints http://localhost:5174/students/<first id>.
 *
 * Resolved at runtime rather than hardcoding a UUID a seed change would
 * silently break.
 */
const API = process.env.API_URL ?? 'http://localhost:3000/api';
const password = process.env.SEED_ADMIN_PASSWORD;
if (!password) {
  console.error('SEED_ADMIN_PASSWORD is not set');
  process.exit(1);
}

const loginRes = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@biddaloy.test', password }),
});
if (!loginRes.ok) {
  console.error(`login failed: ${loginRes.status} ${await loginRes.text()}`);
  process.exit(1);
}
const login = await loginRes.json();

const studentsRes = await fetch(`${API}/students?limit=1`, {
  headers: {
    Authorization: `Bearer ${login.access_token}`,
    'X-Tenant-ID': login.memberships[0].tenantId,
  },
});
if (!studentsRes.ok) {
  console.error(`students list failed: ${studentsRes.status} ${await studentsRes.text()}`);
  process.exit(1);
}
const { data } = await studentsRes.json();
if (!data?.length) {
  console.error('no seeded students found');
  process.exit(1);
}
console.log(`http://localhost:5174/students/${data[0].id}`);
