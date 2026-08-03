import { AbstractLogger, LogLevel, LogMessage, QueryRunner } from "typeorm";
import { Logger as NestLogger } from "@nestjs/common";
import { redactPii } from "./common/redact-log.util";

/**
 * TypeORM's default console logger appends a query's bound parameters as a
 * trailing comment (`-- PARAMETERS: [...]`) — exactly where an email, phone,
 * or any other PII value passed into a WHERE clause ends up in plaintext
 * logs (#36). This keeps the query text (useful for debugging) and drops
 * the parameters entirely, rather than trying to redact them value-by-value.
 *
 * `appendParameterAsComment: false` only covers that — it does nothing for
 * `logQueryError`'s *second* message, which carries the raw driver error
 * text (a Postgres constraint violation can itself echo back an offending
 * value, e.g. a duplicate email). redactPii() runs over the fully
 * formatted text of every message, not just the query, to cover that too.
 */
export class RedactingTypeOrmLogger extends AbstractLogger {
  private readonly logger = new NestLogger("TypeORM");

  protected writeLog(level: LogLevel, logMessage: LogMessage | LogMessage[], queryRunner?: QueryRunner): void {
    const prepared = this.prepareLogMessages(logMessage, {
      highlightSql: false,
      appendParameterAsComment: false,
    });

    for (const message of prepared) {
      const text = redactPii(message.prefix ? `${message.prefix} ${message.message}` : `${message.message}`);
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
