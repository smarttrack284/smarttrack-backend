import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '#/common/constants/supabase.constant';
import { ExternalServiceException } from '#/common/exceptions';

export type UploadFileInput = {
  path: string;
  buffer: Buffer;
  contentType: string;
};

const DEFAULT_BUCKET = 'company-files';

/**
 * The ONE place any module uploads/deletes a file. Every future file
 * feature (driver documents, order photos, etc.) calls through this,
 * not the Supabase Storage client directly — same discipline as
 * EmailProvider/MailService: one narrow interface, easy to reason about,
 * easy to swap the underlying storage provider later without touching
 * every caller.
 */
@Injectable()
export class StorageService {
  private readonly bucket: string;

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    config: ConfigService,
  ) {
    this.bucket =
      config.get<string>('SUPABASE_STORAGE_BUCKET') ?? DEFAULT_BUCKET;
  }

  /** Uploads (or overwrites, via upsert) a file at an exact path and returns its public URL. Caller decides the path — see StoragePath for the convention every path should follow. */
  async uploadFile(input: UploadFileInput): Promise<string> {
    const { error } = await this.supabase.storage
      .from(this.bucket)
      .upload(input.path, input.buffer, {
        contentType: input.contentType,
        upsert: true,
      });

    if (error) {
      throw new ExternalServiceException('Supabase Storage', error.message);
    }

    const { data } = this.supabase.storage
      .from(this.bucket)
      .getPublicUrl(input.path);
    return data.publicUrl;
  }

  /** Deletes a single file by its exact path. */
  async deleteFile(path: string): Promise<void> {
    const { error } = await this.supabase.storage
      .from(this.bucket)
      .remove([path]);
    if (error) {
      throw new ExternalServiceException('Supabase Storage', error.message);
    }
  }

  /**
   * Recursively deletes every file under a folder prefix — this is what
   * makes company deletion clean up ALL of a company's files (logo,
   * future driver documents, future order photos, whatever gets added)
   * in one call, without CompaniesService needing to know the specific
   * list of file categories that exist. Supabase Storage's `list` doesn't
   * recurse into subfolders on its own, so this walks one level at a
   * time and recurses into anything that comes back without a
   * `metadata` field (Supabase's way of distinguishing a folder entry
   * from a file entry in a list response).
   */
  async deleteFolder(prefix: string): Promise<void> {
    const { data: entries, error } = await this.supabase.storage
      .from(this.bucket)
      .list(prefix);
    if (error) {
      throw new ExternalServiceException('Supabase Storage', error.message);
    }
    if (!entries || entries.length === 0) return;

    const filePaths: string[] = [];
    const subfolders: string[] = [];

    for (const entry of entries) {
      const fullPath = `${prefix}/${entry.name}`;
      if (entry.metadata) {
        filePaths.push(fullPath);
      } else {
        subfolders.push(fullPath);
      }
    }

    if (filePaths.length > 0) {
      const { error: removeError } = await this.supabase.storage
        .from(this.bucket)
        .remove(filePaths);
      if (removeError)
        throw new ExternalServiceException(
          'Supabase Storage',
          removeError.message,
        );
    }

    for (const subfolder of subfolders) {
      await this.deleteFolder(subfolder);
    }
  }

  /**
   * Recursively lists every file path under a folder prefix.
   * This is used by the storage cleanup reconciliation job to compare
   * against referenced files and find orphans.
   *
   * Returns an array of full relative paths (e.g., `admin/avatars/xxx/file.png`).
   */
  async listFiles(prefix: string): Promise<string[]> {
    const { data: entries, error } = await this.supabase.storage
      .from(this.bucket)
      .list(prefix);

    if (error) {
      throw new ExternalServiceException('Supabase Storage', error.message);
    }
    if (!entries || entries.length === 0) return [];

    const filePaths: string[] = [];
    const subfolders: string[] = [];

    for (const entry of entries) {
      const fullPath = `${prefix}/${entry.name}`;
      if (entry.metadata) {
        filePaths.push(fullPath);
      } else {
        subfolders.push(fullPath);
      }
    }

    // Recurse into subfolders and combine results
    for (const subfolder of subfolders) {
      const nestedFiles = await this.listFiles(subfolder);
      filePaths.push(...nestedFiles);
    }

    return filePaths;
  }
}