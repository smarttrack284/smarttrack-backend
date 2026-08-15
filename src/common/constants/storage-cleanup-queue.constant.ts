export const STORAGE_CLEANUP_QUEUE_NAME = 'storage-cleanup';

export enum StorageCleanupJobName {
  DELETE_OBJECT = 'delete-object',
  DELETE_FOLDER = 'delete-folder',
  RECONCILE_PREFIX = 'reconcile-prefix',
}

export type DeleteObjectJobData = {
  path: string;
  reason: string;
};

export type DeleteFolderJobData = {
  prefix: string;
  reason: string;
};

export type ReconcilePrefixJobData = {
  prefix: string;
};