import { Injectable, Logger } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { MAIL_QUEUE_NAME, MailJobName } from "./constants/mail-queue.constant";
import type {
    MailTemplate,
    MailTemplateContextMap
} from "./interfaces/mail-template.interface";
import {
    ErrorHandlerService,
    rule
} from "#/common/errors/error-handler.service";
import { InternalErrorException } from "#/common/exceptions";


@Injectable()
export class MailService {
    private readonly logger = new Logger(MailService.name);

    constructor(
        @InjectQueue(MAIL_QUEUE_NAME) private readonly mailQueue: Queue,
        private readonly errorHandler: ErrorHandlerService
    ) {}

    async sendTemplateEmail<T extends MailTemplate>(params: {
        to: string;
        subject: string;
        templateName: T;
        context: MailTemplateContextMap[T];
    }): Promise<void> {
        try {
            await this.mailQueue.add(
                MailJobName.SEND_TEMPLATE_EMAIL,
                {
                    to: params.to,
                    subject: params.subject,
                    templateName: params.templateName,
                    context: params.context
                },
                {
                    attempts: 3,
                    backoff: { type: "exponential", delay: 5000 },
                    removeOnComplete: 1000,
                    removeOnFail: 5000
                }
            );
        } catch (err) {
            this.errorHandler.handle(err, "MailService.sendTemplateEmail", [
                rule(
                    Error,
                    () =>
                        new InternalErrorException(
                            "Unable to send email at this moment. Please try again later."
                        )
                )
            ]);
        }
    }
}
