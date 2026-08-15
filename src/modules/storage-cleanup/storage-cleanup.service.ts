import { Injectable, Logger, Inject } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { InjectRepository } from "@nestjs/typeorm";
import { Queue } from "bullmq";
import { Repository } from "typeorm";
import { AdminUser } from "#/common/entities/admin-user.entity";
import { Company } from "#/common/entities/company.entity";
import { UserRole } from "#/common/entities/user-role.entity";
import { TripStop } from "#/common/entities/trip-stop.entity";
import { SUPABASE_CLIENT } from "#/common/constants/supabase.constant";
import type { SupabaseClient } from "@supabase/supabase-js";
import { StorageService } from "#/common/storage/storage.service";
import { StoragePath } from "#/common/storage/storage-path.util";
import {
    STORAGE_CLEANUP_QUEUE_NAME,
    StorageCleanupJobName
} from "#/common/constants/storage-cleanup-queue.constant";

@Injectable()
export class StorageCleanupService {
    private readonly logger = new Logger(StorageCleanupService.name);

    constructor(
        @InjectQueue(STORAGE_CLEANUP_QUEUE_NAME)
        private readonly cleanupQueue: Queue,
        @InjectRepository(AdminUser)
        private readonly adminUserRepo: Repository<AdminUser>,
        @InjectRepository(Company)
        private readonly companyRepo: Repository<Company>,
        @InjectRepository(UserRole)
        private readonly userRoleRepo: Repository<UserRole>,
        @InjectRepository(TripStop)
        private readonly tripStopRepo: Repository<TripStop>,
        @Inject(SUPABASE_CLIENT)
        private readonly supabaseAdmin: SupabaseClient,
        private readonly storageService: StorageService
    ) {}

    /**
     * Enqueue a file deletion. Idempotent via jobId based on path.
     */
    async enqueueDelete(path: string, reason: string): Promise<void> {
        const jobId = `delete:${path}`;
        try {
            await this.cleanupQueue.add(
                StorageCleanupJobName.DELETE_OBJECT,
                { path, reason },
                {
                    jobId,
                    attempts: 5,
                    backoff: { type: "exponential", delay: 5000 },
                    removeOnComplete: true,
                    removeOnFail: 1000
                }
            );
        } catch (err) {
            this.logger.warn({
                msg: "Failed to enqueue storage cleanup delete",
                path,
                reason,
                err: err instanceof Error ? err.message : String(err)
            });
        }
    }

    /**
     * Enqueue a reconciliation scan for a given prefix.
     */
    async enqueueReconcile(prefix: string): Promise<void> {
        const jobId = `reconcile:${prefix}`;
        try {
            await this.cleanupQueue.add(
                StorageCleanupJobName.RECONCILE_PREFIX,
                { prefix },
                {
                    jobId,
                    attempts: 1,
                    removeOnComplete: true,
                    removeOnFail: 500
                }
            );
        } catch (err) {
            this.logger.warn({
                msg: "Failed to enqueue storage cleanup reconcile",
                prefix,
                err: err instanceof Error ? err.message : String(err)
            });
        }
    }
    
    async enqueueDeleteFolder(prefix: string, reason: string): Promise<void> {
  const jobId = `delete-folder:${prefix}`;
  try {
    await this.cleanupQueue.add(
      StorageCleanupJobName.DELETE_FOLDER,
      { prefix, reason },
      {
        jobId,
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: 1000,
      },
    );
  } catch (err) {
    this.logger.warn({
      msg: 'Failed to enqueue storage cleanup folder delete',
      prefix,
      reason,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

    /**
     * Dispatch orphan detection based on the prefix.
     */
    async findOrphanedFilesForPrefix(prefix: string): Promise<string[]> {
        if (prefix === "admin/avatars") {
            return this.findOrphanedAdminAvatars();
        }

        if (prefix === "companies") {
            return this.findOrphanedCompanyFiles();
        }

        this.logger.warn({
            msg: "Reconciliation not implemented for this prefix",
            prefix
        });
        return [];
    }

    /**
     * Admin avatars – compares against active admin users' Supabase metadata.
     */
    private async findOrphanedAdminAvatars(): Promise<string[]> {
        const allFiles = await this.storageService.listFiles("admin/avatars");
        if (allFiles.length === 0) return [];

        const adminUsers = await this.adminUserRepo.find({
            where: { isActive: true },
            select: { userId: true }
        });

        const referencedPaths = new Set<string>();

        for (const admin of adminUsers) {
            try {
                const { data } =
                    await this.supabaseAdmin.auth.admin.getUserById(
                        admin.userId
                    );
                const metadata =
                    (data.user?.user_metadata as Record<string, unknown>) ?? {};
                const filename = metadata.avatar_filename as string | undefined;
                if (filename) {
                    referencedPaths.add(
                        StoragePath.adminAvatar(admin.userId, filename)
                    );
                }
            } catch (err) {
                this.logger.warn({
                    msg: "Failed to fetch Supabase user during reconciliation",
                    userId: admin.userId,
                    err: err instanceof Error ? err.message : String(err)
                });
            }
        }

        return allFiles.filter(filePath => !referencedPaths.has(filePath));
    }

    /**
     * Company files (master method) – combines all company-scoped orphans.
     */
    private async findOrphanedCompanyFiles(): Promise<string[]> {
        const [
            logos,
            customerAvatars,
            proofOfDelivery
        ] = await Promise.all([
            this.findOrphanedCompanyLogos(),
            this.findOrphanedCustomerAvatars(),
            this.findOrphanedProofOfDelivery()
        ]);

        return [...logos, ...customerAvatars, ...proofOfDelivery];
    }

    /**
     * Company logos – compares against `Company.logoFilename`.
     */
    private async findOrphanedCompanyLogos(): Promise<string[]> {
        const allFiles = await this.storageService.listFiles("companies");
        if (allFiles.length === 0) return [];

        const companies = await this.companyRepo.find({
            select: { id: true, logoFilename: true }
        });

        const referencedPaths = new Set<string>();
        for (const company of companies) {
            if (company.logoFilename) {
                referencedPaths.add(
                    StoragePath.companyLogo(company.id, company.logoFilename)
                );
            }
        }

        // Only return files under /logo/ that are not referenced
        return allFiles.filter(
            filePath =>
                filePath.includes("/logo/") && !referencedPaths.has(filePath)
        );
    }

    /**
     * Customer avatars – compares against Supabase metadata for each user.
     */
    private async findOrphanedCustomerAvatars(): Promise<string[]> {
        const allFiles = await this.storageService.listFiles("companies");
        if (allFiles.length === 0) return [];

        const userRoles = await this.userRoleRepo.find({
            select: { userId: true, companyId: true }
        });

        const uniqueUserIds = [
            ...new Set(
                userRoles
                    .map(ur => ur.userId)
                    .filter((id): id is string => !!id)
            )
        ];

        const avatarFilenameByUserId = new Map<string, string>();
        for (const userId of uniqueUserIds) {
            try {
                const { data } =
                    await this.supabaseAdmin.auth.admin.getUserById(userId);
                const metadata =
                    (data.user?.user_metadata as Record<string, unknown>) ?? {};
                const filename = metadata.avatar_filename as string | undefined;
                if (filename) {
                    avatarFilenameByUserId.set(userId, filename);
                }
            } catch {
                // ignore individual lookup errors
            }
        }

        const referencedPaths = new Set<string>();
        for (const role of userRoles) {
            if (!role.userId) continue;
            const filename = avatarFilenameByUserId.get(role.userId);
            if (filename) {
                referencedPaths.add(
                    StoragePath.userAvatar(
                        role.companyId,
                        role.userId,
                        filename
                    )
                );
            }
        }

        return allFiles.filter(
            filePath =>
                filePath.includes("/users/") && !referencedPaths.has(filePath)
        );
    }

    /**
     * Proof-of-delivery files – compares against TripStop PoD URLs.
     */
    private async findOrphanedProofOfDelivery(): Promise<string[]> {
        const allFiles = await this.storageService.listFiles("companies");
        if (allFiles.length === 0) return [];

        const stops = await this.tripStopRepo.find({
            relations: { trip: true }
        });

        const referencedPaths = new Set<string>();
        for (const stop of stops) {
            const companyId = stop.trip?.companyId;
            if (!companyId) continue;

            if (stop.podPhotoUrl) {
                const filename = this.getFilenameFromUrl(stop.podPhotoUrl);
                if (filename) {
                    referencedPaths.add(
                        StoragePath.proofOfDelivery(
                            companyId,
                            stop.id,
                            filename
                        )
                    );
                }
            }

            if (stop.podSignatureUrl) {
                const filename = this.getFilenameFromUrl(stop.podSignatureUrl);
                if (filename) {
                    referencedPaths.add(
                        StoragePath.proofOfDelivery(
                            companyId,
                            stop.id,
                            filename
                        )
                    );
                }
            }
        }

        return allFiles.filter(
            filePath =>
                filePath.includes("/pod/") && !referencedPaths.has(filePath)
        );
    }

    /**
     * Extracts the filename from a Supabase public URL.
     */
    private getFilenameFromUrl(url: string): string | undefined {
        try {
            const pathname = new URL(url).pathname;
            const segments = pathname.split("/");
            return segments.length > 0
                ? segments[segments.length - 1]
                : undefined;
        } catch {
            return undefined;
        }
    }
}