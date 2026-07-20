import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import type { MultipartFile } from '@fastify/multipart';

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
]);

/**
 * Reusable across any future file-upload endpoint, not logo-specific —
 * takes the multipart file + its already-buffered content, validates
 * size/type, and returns the buffer ready for StorageService. If a
 * different upload category later needs different limits (e.g. a larger
 * ceiling for order photos), pass options rather than hardcoding here.
 */
@Injectable()
export class FileValidationPipe implements PipeTransform {
  transform(value: { file: MultipartFile; buffer: Buffer }) {
    if (!ALLOWED_MIME_TYPES.has(value.file.mimetype)) {
      throw new BadRequestException(
        `Unsupported file type "${value.file.mimetype}". Allowed: PNG, JPEG, WEBP, SVG.`,
      );
    }
    if (value.buffer.length > MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException('File exceeds the 5MB size limit.');
    }
    return value;
  }
}
