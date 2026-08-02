import { ExceptionFilter, Catch, ArgumentsHost, Logger } from "@nestjs/common";
import { randomUUID } from "crypto";
import { Request, Response } from "express";
import { buildErrorResponseBody, resolveDetailMessage, resolveStatus } from "./error-response";

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly nodeEnv: string | undefined = process.env.NODE_ENV) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const incomingRequestId = request.headers["x-request-id"];
    const requestId =
      typeof incomingRequestId === "string" && incomingRequestId.length > 0 ? incomingRequestId : randomUUID();

    const status = resolveStatus(exception);
    const body = buildErrorResponseBody(exception, {
      path: request.url,
      requestId,
      nodeEnv: this.nodeEnv,
    });

    // Logged detail is never suppressed, even in production — that's what
    // lets support map a user-reported requestId back to the real cause.
    const detail = resolveDetailMessage(exception);
    this.logger.error(
      `${request.method} ${request.url} → ${status}: ${Array.isArray(detail) ? detail.join("; ") : detail} [requestId=${requestId}]`,
      exception instanceof Error ? exception.stack : undefined,
    );

    response.setHeader("X-Request-Id", requestId);
    response.status(status).json(body);
  }
}
