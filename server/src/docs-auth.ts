import { createHash, timingSafeEqual } from "crypto";
import { Request, Response, NextFunction } from "express";

/**
 * Hashing both sides to a fixed-length digest first, rather than comparing
 * the raw strings, means timingSafeEqual never has to reject on a length
 * mismatch before it even runs — a length-based branch there would leak
 * the correct credential's length via response timing.
 */
function safeCompare(a: string, b: string): boolean {
  const hashA = createHash("sha256").update(a).digest();
  const hashB = createHash("sha256").update(b).digest();
  return timingSafeEqual(hashA, hashB);
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
