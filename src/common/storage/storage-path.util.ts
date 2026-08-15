/**
 * Every company-scoped file lives under companies/{companyId}/... — this
 * single convention is what makes "delete a company, delete its files" a
 * one-line recursive folder delete (see StorageService.deleteFolder),
 * rather than needing to track every file's path individually somewhere
 * just to clean them up later.
 *
 * Add a new folder function here for each new file category as they come
 * up (driver documents, order photos, etc.) — all under the same
 * companies/{companyId}/ root, so the same cleanup-on-delete logic covers
 * every category automatically without needing to know about each one.
 */
export const StoragePath = {
    companyRoot: (companyId: string) => `companies/${companyId}`,
    
    companyLogo: (companyId: string, filename: string) =>
        `companies/${companyId}/logo/${filename}`,
        
    userAvatar: (companyId: string, userId: string, filename: string) =>
        `companies/${companyId}/users/${userId}/avatar/${filename}`,
        
    proofOfDelivery: (
        companyId: string,
        tripStopId: string,
        filename: string
    ) => `companies/${companyId}/pod/${tripStopId}/${filename}`,
    
    adminAvatar(adminUserId: string, filename: string): string {
  return `admin/avatars/${adminUserId}/${filename}`;
}
} as const;

