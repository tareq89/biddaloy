import { DocumentBuilder, OpenAPIObject } from "@nestjs/swagger";
import { API_VERSION } from "./api-versioning";

/** Mounted at /api/docs — version-neutral, like /api/health, so it doesn't move on a version bump. */
export const DOCS_PATH = "docs";

export function buildSwaggerDocumentConfig(): Omit<OpenAPIObject, "paths"> {
  return new DocumentBuilder()
    .setTitle("biddaloy API")
    .setDescription(
      "School fee management API. Every authenticated route additionally requires the " +
        "X-Tenant-ID header, validated against the caller's memberships by ContextGuard; " +
        "X-Role is optional and only needed to pick a non-default role when a user has " +
        "more than one membership.",
    )
    .setVersion(API_VERSION)
    .addBearerAuth({ type: "http", scheme: "bearer", bearerFormat: "JWT" }, "bearer")
    .build();
}

/**
 * Docs mount in development by default (no gate needed — nothing sensitive
 * about a dev environment's own API shape) and in production only when
 * explicitly opted into via ENABLE_API_DOCS=true, which main.ts then also
 * puts behind Basic Auth. Never mounted in production otherwise — the
 * route doesn't exist, so it 404s rather than merely rejecting requests.
 */
export function shouldMountDocs(nodeEnv: string | undefined, enableApiDocsEnv: string | undefined): boolean {
  return nodeEnv !== "production" || enableApiDocsEnv === "true";
}
