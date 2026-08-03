import { AbstractLogger, LogLevel, LogMessage, QueryRunner } from "typeorm";
import { Logger as NestLogger } from "@nestjs/common";

/**
 * TypeORM's default console logger appends a query's bound parameters as a
 * trailing comment (`-- PARAMETERS: [...]`) — exactly where an email, phone,
 * or any other PII value passed into a WHERE clause ends up in plaintext
 * logs (#36). This keeps the query text (useful for debugging) and drops
 * the parameters entirely, rather than trying to redact them value-by-value.
 */
export class RedactingTypeOrmLogger extends AbstractLogger {
  private readonly logger = new NestLogger("TypeORM");

  protected writeLog(level: LogLevel, logMessage: LogMessage | LogMessage[], queryRunner?: QueryRunner): void {
    const prepared = this.prepareLogMessages(logMessage, {
      highlightSql: false,
      appendParameterAsComment: false,
    });

    for (const message of prepared) {
      const text = message.prefix ? `${message.prefix} ${message.message}` : `${message.message}`;
      switch (level) {
        case "error":
        case "warn":
          this.logger.warn(text);
          break;
        default:
          this.logger.log(text);
      }
    }
  }
}
