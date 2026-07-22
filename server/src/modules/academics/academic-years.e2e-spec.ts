import { describe, it, expect, beforeAll, afterAll } from "vitest";
import supertest = require("supertest");
import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { AppModule } from "../../app.module";
import { DataSource } from "typeorm";
import { UserRole } from "@beton-boi/shared";
import { SEED_TENANT_ID, SEED_ADMIN_EMAIL, SEED_ADMIN_USER_ID, SEED_ADMIN_PASSWORD } from "@test/constants";

/**
 * E2E tests for Academic Year endpoints.
 *
 * Tests the full HTTP layer: authentication, tenant context, role guard,
 * and academic year CRUD with the "set current" business logic.
 */

describe("Academic Years E2E", () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;

  const TENANT_ID = SEED_TENANT_ID;

  beforeAll(async () => {
    // Ensure test database is used
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://postgres:***@localhost:5432/betonboi";
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-do-not-use-in-production";
    process.env.NODE_ENV = "test";

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
    await app.listen(0); // Random port

    dataSource = app.get(DataSource);

    // Log in as admin to get a token
    const loginRes = await supertest(app.getHttpServer())
      .post("/auth/login")
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);

    adminToken = loginRes.body.access_token;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  describe("POST /academic-years", () => {
    it("should create an academic year (ADMIN role)", async () => {
      const res = await supertest(app.getHttpServer())
        .post("/academic-years")
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Tenant-ID", TENANT_ID)
        .send({
          name: "2027-2028",
          start_date: "2027-01-01",
          end_date: "2027-12-31",
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe("2027-2028");
      expect(res.body.tenant_id).toBe(TENANT_ID);
    });

    it("should return 401 without X-Tenant-ID header", async () => {
      const res = await supertest(app.getHttpServer())
        .post("/academic-years")
        .set("Authorization", `Bearer ${adminToken}`)
        // No X-Tenant-ID
        .send({
          name: "2027-2028",
          start_date: "2027-01-01",
          end_date: "2027-12-31",
        })
        .expect(401);

      expect(res.body.message).toBe("X-Tenant-ID header is required");
    });

    it("should return 403 for STUDENT role", async () => {
      // Create a user-tenant with STUDENT role for the seed tenant
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ('${SEED_ADMIN_USER_ID}', '${SEED_TENANT_ID}', '${UserRole.STUDENT}', NOW(), NOW())`,
      );

      // Get a fresh token with the STUDENT role included in the JWT
      const loginRes = await supertest(app.getHttpServer())
        .post("/auth/login")
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200);
      const studentToken = loginRes.body.access_token;

      const res = await supertest(app.getHttpServer())
        .post("/academic-years")
        .set("Authorization", `Bearer ${studentToken}`)
        .set("X-Tenant-ID", TENANT_ID)
        .set("X-Role", UserRole.STUDENT)
        .send({
          name: "2027-2028",
          start_date: "2027-01-01",
          end_date: "2027-12-31",
        })
        .expect(401);

      expect(res.body.message).toContain("Requires one of roles");
    });

    it("should return 500 for invalid DTO (missing required fields)", async () => {
      const res = await supertest(app.getHttpServer())
        .post("/academic-years")
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Tenant-ID", TENANT_ID)
        .send({})
        .expect(500);
    });
  });

  describe("POST /academic-years/:id/set-current", () => {
    it("should set an academic year as current and unset others", async () => {
      // Create two academic years
      const year1 = await supertest(app.getHttpServer())
        .post("/academic-years")
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Tenant-ID", TENANT_ID)
        .send({ name: "2025-2026", start_date: "2025-01-01", end_date: "2025-12-31" })
        .expect(201);

      const year2 = await supertest(app.getHttpServer())
        .post("/academic-years")
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Tenant-ID", TENANT_ID)
        .send({ name: "2028-2029", start_date: "2028-01-01", end_date: "2028-12-31" })
        .expect(201);

      // Set year2 as current
      const setCurrentRes = await supertest(app.getHttpServer())
        .post(`/academic-years/${year2.body.id}/set-current`)
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Tenant-ID", TENANT_ID)
        .expect(201);

      expect(setCurrentRes.body.is_current).toBe(true);

      // Verify year1 is no longer current
      const getYear1 = await supertest(app.getHttpServer())
        .get(`/academic-years/${year1.body.id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Tenant-ID", TENANT_ID)
        .expect(200);

      expect(getYear1.body.is_current).toBe(false);
    });
  });

  describe("GET /academic-years", () => {
    it("should return paginated academic years", async () => {
      const res = await supertest(app.getHttpServer())
        .get("/academic-years")
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Tenant-ID", TENANT_ID)
        .expect(200);

      expect(res.body.data).toBeDefined();
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.total).toBeDefined();
      expect(res.body.page).toBe(1);
    });
  });

  describe("GET /academic-years/:id", () => {
    it("should return an academic year by ID", async () => {
      const createRes = await supertest(app.getHttpServer())
        .post("/academic-years")
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Tenant-ID", TENANT_ID)
        .send({ name: "Find Test", start_date: "2026-01-01", end_date: "2026-12-31" })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .get(`/academic-years/${createRes.body.id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Tenant-ID", TENANT_ID)
        .expect(200);

      expect(res.body.id).toBe(createRes.body.id);
      expect(res.body.name).toBe("Find Test");
    });

    it("should return 404 for a non-existent academic year", async () => {
      const res = await supertest(app.getHttpServer())
        .get("/academic-years/00000000-0000-0000-0000-000000000000")
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Tenant-ID", TENANT_ID)
        .expect(404);
    });
  });

  describe("PATCH /academic-years/:id", () => {
    it("should update an academic year", async () => {
      const createRes = await supertest(app.getHttpServer())
        .post("/academic-years")
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Tenant-ID", TENANT_ID)
        .send({ name: "Original Name", start_date: "2026-01-01", end_date: "2026-12-31" })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .patch(`/academic-years/${createRes.body.id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Tenant-ID", TENANT_ID)
        .send({ name: "Updated Name" })
        .expect(200);

      expect(res.body.name).toBe("Updated Name");
    });

    it("should return 403 for STUDENT role on update", async () => {
      const createRes = await supertest(app.getHttpServer())
        .post("/academic-years")
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Tenant-ID", TENANT_ID)
        .send({ name: "Role Check", start_date: "2026-01-01", end_date: "2026-12-31" })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .patch(`/academic-years/${createRes.body.id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Tenant-ID", TENANT_ID)
        .set("X-Role", UserRole.STUDENT)
        .send({ name: "Should Not Update" })
        .expect(401);
    });
  });

  describe("DELETE /academic-years/:id", () => {
    it("should soft delete an academic year", async () => {
      const createRes = await supertest(app.getHttpServer())
        .post("/academic-years")
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Tenant-ID", TENANT_ID)
        .send({ name: "Delete Me", start_date: "2026-01-01", end_date: "2026-12-31" })
        .expect(201);

      // Soft delete
      await supertest(app.getHttpServer())
        .delete(`/academic-years/${createRes.body.id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Tenant-ID", TENANT_ID)
        .expect(200);

      // Verify not found
      await supertest(app.getHttpServer())
        .get(`/academic-years/${createRes.body.id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Tenant-ID", TENANT_ID)
        .expect(404);
    });

    it("should return 403 for STUDENT role on delete", async () => {
      const createRes = await supertest(app.getHttpServer())
        .post("/academic-years")
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Tenant-ID", TENANT_ID)
        .send({ name: "Protected", start_date: "2026-01-01", end_date: "2026-12-31" })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .delete(`/academic-years/${createRes.body.id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Tenant-ID", TENANT_ID)
        .set("X-Role", UserRole.STUDENT)
        .expect(401);
    });
  });
});
