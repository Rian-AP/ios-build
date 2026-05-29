// Shared cancellation state — imported by both downloads.ts and offlineDownloads.ts
// to avoid a circular dependency between them.

export const cancelledIds = new Set<string>();

// Permanently deleted IDs — upsertDownload should not restore these
export const deletedIds = new Set<string>();

export function cancelDownload(downloadId: string) {
  cancelledIds.add(downloadId);
}
