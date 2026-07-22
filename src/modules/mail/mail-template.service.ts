import { Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Handlebars from 'handlebars';
import {
  MailTemplate,
  type MailTemplateContextMap,
} from './interfaces/mail-template.interface';

@Injectable()
export class MailTemplateService {
  private logger = new Logger(MailTemplateService.name);
  // Compiled templates cached in memory after first use — reading and
  // compiling a .hbs file on every single email send would be wasted work
  // under any real send volume; the file layout never changes at runtime.
  private readonly compiledCache = new Map<
    MailTemplate,
    HandlebarsTemplateDelegate
  >();

  render<T extends MailTemplate>(
    templateName: T,
    context: MailTemplateContextMap[T],
  ): string {
    const compiled = this.getCompiled(templateName);

    return compiled(context);
  }

  private getCompiled(templateName: MailTemplate): HandlebarsTemplateDelegate {
    const cached = this.compiledCache.get(templateName);
    if (cached) return cached;

    const filePath = join(__dirname, 'templates', `${templateName}.hbs`);

    try {
      const source = readFileSync(filePath, 'utf-8');
      const compiled = Handlebars.compile(source);

      this.compiledCache.set(templateName, compiled);
      return compiled;
    } catch (error) {
      this.logger.error(
        `Failed to load template '${templateName}' at ${filePath}`,
        error,
      );

      // Re-throw the error so the BullMQ job registers as failed
      // and can be retried or moved to the dead-letter queue.
      throw error;
    }
  }
}
