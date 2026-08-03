import { timingSafeEqual } from "crypto";
import { Request, Response, NextFunction } from "express";

/**
 * Zero-pads both sides to the same fixed-ish length before comparing, so
 * timingSafeEqual — which requires equal-length buffers — never has to
 * reject on a length mismatch before it even runs; that branch would leak
 * the correct credential's length via response timing. The final `&&`
 * against the real (unpadded) lengths is safe to leave non-constant-time:
 * comparing two already-known integers doesn't touch secret byte content,
 * so there's nothing about it a timing attack could learn.
 *
 * Deliberately not hashing the inputs first (an earlier version did, via
 * SHA-256) — a fast general-purpose hash is the wrong tool for password
 * comparison and correctly trips security scanners for exactly that
 * pattern, even though this specific use was for timing-safety rather
 * than storage. Padding avoids the pattern entirely.
 */
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  const paddedLength = Math.max(bufA.length, bufB.length, 32);

  const paddedA = Buffer.alloc(paddedLength);
  const paddedB = Buffer.alloc(paddedLength);
  bufA.copy(paddedA);
  bufB.copy(paddedB);

  return bufA.length === bufB.length && timingSafeEqual(paddedA, paddedB);
}

/**
 * Basic Auth in front of the docs route in production (see swagger.ts's
 * shouldMountDocs). Not a general-purpose auth mechanism — just enough to
 * keep the API shape out of anonymous reach when ENABLE_API_DOCS=true.
 */
export function buildDocsBasicAuthMiddleware(username: string, password: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;

    if (header?.startsWith("Basic ")) {
      const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf8");
      const separatorIndex = decoded.indexOf(":");

      if (separatorIndex !== -1) {
        const user = decoded.slice(0, separatorIndex);
        const pass = decoded.slice(separatorIndex + 1);

        if (safeCompare(user, username) && safeCompare(pass, password)) {
          return next();
        }
      }
    }

    res.set("WWW-Authenticate", 'Basic realm="API Docs"');
    res.status(401).send("Authentication required");
  };
}

/**
 * swagger-ui-express's bundled page ships an inline initializer script and
 * inline styles; the app's global CSP (security-headers.ts) has no
 * 'unsafe-inline' anywhere, by design, for every other route. Rather than
 * loosen that for the whole app, this overrides just the docs path's CSP
 * with the minimum swagger-ui actually needs.
 */
export function buildDocsCspOverrideMiddleware(docsPathPrefix: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith(docsPathPrefix)) {
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;",
      );
    }
    next();
  };
}
