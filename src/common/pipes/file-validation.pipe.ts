import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { MultipartFile } from '@fastify/multipart';

interface FileValidationOptions {
  allowedMimeTypes: Set<string>;
  maxSizeBytes: number;
}

/**
 * Configurable file validation pipe.
 * Usage: new FileValidationPipe({ allowedMimeTypes: new Set(['image/png', ...]), maxSizeBytes: 5 * 1024 * 1024 })
 */
export class FileValidationPipe implements PipeTransform {
  constructor(private readonly options: FileValidationOptions) {}

  transform(value: { file: MultipartFile; buffer: Buffer }) {
    if (!this.options.allowedMimeTypes.has(value.file.mimetype)) {
      throw new BadRequestException(
        `Unsupported file type "${value.file.mimetype}". Allowed: ${Array.from(this.options.allowedMimeTypes).join(', ')}.`,
      );
    }
    if (value.buffer.length > this.options.maxSizeBytes) {
      throw new BadRequestException(
        `File exceeds the ${(this.options.maxSizeBytes / (1024 * 1024)).toFixed(1)}MB size limit.`,
      );
    }
    return value;
  }
}
