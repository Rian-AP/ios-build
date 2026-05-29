import AsyncStorage from '@react-native-async-storage/async-storage';

import type { AnimeTitle } from '@/lib/api';
import { proxyImageUrl } from '@/lib/api';
import { cancelDownload, deletedIds } from '@/lib/downloadCancellation';
import { clearCloudDownloads, pushDownloadToCloud, removeDownloadFromCloud } from '@/lib/sync';

const DOWNLOADS_KEY = 'offline_downloads_v1';
const MAX_DOWNLOADS = 200;
let downloadsWriteQueue: Promise<void> = Promise.resolve();

export type DownloadStatus = 'queued' | 'downloading' | 'paused' | 'completed' | 'failed';

export interface DownloadItem {
  id: string;
  animeId: string;
  animeTitle: string;
  animeTitleByLanguage?: AnimeTitle;
  cover?: string | null;
  shikimoriId?: string | null;
  anilistId?: string | null;
  episodeId: string;
  episodeTitle: string;
  episodeNumber?: string | null;
  teamSlug?: string | null;
  teamName?: string | null;
  translationType?: string | null;
  quality?: string | null;
  status: DownloadStatus;
  progress?: number;
  bytesDownloaded?: number;
  totalBytes?: number;
  remoteStreamUrl?: string | null;
  localPlaylistUri?: string | null;
  storageDirUri?: string | null;
  error?: string | null;
  savedAt: number;
  updatedAt: number;
}

export const buildDownloadId = (episodeId: string, teamSlug?: string | null, quality?: string | null) =>
  `${episodeId}:${String(teamSlug || '').trim()}:${String(quality || '').trim()}`;

const toNonNegativeFiniteNumber = (value: unknown) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, numeric);
};

const toProgressValue = (value: unknown) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(numeric, 1));
};

const listeners = new Set<(items: DownloadItem[]) => void>();

const notifyListeners = (items: DownloadItem[]) => {
  listeners.forEach((listener) => {
    listener(items);
  });
};

const sanitizeTitle = (value: unknown): AnimeTitle | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const title = value as Partial<Record<keyof AnimeTitle, unknown>>;
  return {
    ru: title.ru != null ? String(title.ru) : null,
    en: title.en != null ? String(title.en) : null,
    jp: title.jp != null ? String(title.jp) : null,
  };
};

const sanitize = (value: unknown): DownloadItem[] => {
  if (!Array.isArray(value)) return [];

  const mapped = value
    .map((item) => {
      const entry = item as Partial<DownloadItem>;
      if (!entry.id || !entry.animeId || !entry.episodeId) return null;

      const status =
        entry.status === 'downloading' ||
        entry.status === 'paused' ||
        entry.status === 'completed' ||
        entry.status === 'failed' ||
        entry.status === 'queued'
          ? entry.status
          : 'queued';

      const savedAt = Number(entry.savedAt || Date.now());
      const updatedAt = Number(entry.updatedAt || savedAt);
      return {
        id: String(entry.id),
        animeId: String(entry.animeId),
        animeTitle: String(entry.animeTitle || '').trim(),
        animeTitleByLanguage: sanitizeTitle(entry.animeTitleByLanguage),
        cover: proxyImageUrl(entry.cover, entry.shikimoriId, entry.anilistId),
        shikimoriId: String(entry.shikimoriId || '').trim() || null,
        anilistId: String(entry.anilistId || '').trim() || null,
        episodeId: String(entry.episodeId),
        episodeTitle: String(entry.episodeTitle || '').trim(),
        episodeNumber: entry.episodeNumber != null ? String(entry.episodeNumber) : null,
        teamSlug: String(entry.teamSlug || '').trim() || null,
        teamName: String(entry.teamName || '').trim() || null,
        translationType: String(entry.translationType || '').trim() || null,
        quality: String(entry.quality || '').trim() || null,
        status,
        progress: toProgressValue(entry.progress),
        bytesDownloaded: toNonNegativeFiniteNumber(entry.bytesDownloaded),
        totalBytes: toNonNegativeFiniteNumber(entry.totalBytes),
        remoteStreamUrl: String(entry.remoteStreamUrl || '').trim() || null,
        localPlaylistUri: String(entry.localPlaylistUri || '').trim() || null,
        storageDirUri: String(entry.storageDirUri || '').trim() || null,
        error: String(entry.error || '').trim() || null,
        savedAt,
        updatedAt,
      } as DownloadItem;
    })
    .filter((item): item is DownloadItem => Boolean(item));

  const uniqueById = new Map<string, DownloadItem>();
  for (const item of mapped) {
    const existing = uniqueById.get(item.id);
    if (!existing || item.updatedAt >= existing.updatedAt) {
      uniqueById.set(item.id, item);
    }
  }

  return Array.from(uniqueById.values())
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_DOWNLOADS);
};

const enqueueDownloadsWrite = (operation: () => Promise<void>) => {
  downloadsWriteQueue = downloadsWriteQueue.catch(() => undefined).then(operation);
  return downloadsWriteQueue;
};

export async function getDownloads(): Promise<DownloadItem[]> {
  const raw = await AsyncStorage.getItem(DOWNLOADS_KEY);
  if (!raw) return [];
  try {
    return sanitize(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function subscribeDownloads(listener: (items: DownloadItem[]) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function upsertDownload(
  item: Omit<DownloadItem, 'savedAt' | 'updatedAt'> & Partial<Pick<DownloadItem, 'savedAt'>>
): Promise<void> {
  return enqueueDownloadsWrite(async () => {
    const current = await getDownloads();
    const existing = current.find((entry) => entry.id === item.id);
    const now = Date.now();

    const nextEntry: DownloadItem = {
      ...item,
      animeTitle: String(item.animeTitle || '').trim(),
      episodeTitle: String(item.episodeTitle || '').trim(),
      cover: item.cover || null,
      episodeNumber: item.episodeNumber != null ? String(item.episodeNumber) : null,
      teamSlug: String(item.teamSlug || '').trim() || null,
      teamName: String(item.teamName || '').trim() || null,
      translationType: String(item.translationType || '').trim() || null,
      quality: String(item.quality || '').trim() || null,
      progress: toProgressValue(item.progress),
      bytesDownloaded: toNonNegativeFiniteNumber(item.bytesDownloaded),
      totalBytes: toNonNegativeFiniteNumber(item.totalBytes),
      remoteStreamUrl: String(item.remoteStreamUrl || '').trim() || null,
      localPlaylistUri: String(item.localPlaylistUri || '').trim() || null,
      storageDirUri: String(item.storageDirUri || '').trim() || null,
      error: String(item.error || '').trim() || null,
      savedAt: Number(item.savedAt || existing?.savedAt || now),
      updatedAt: now,
    };

    const next = [nextEntry, ...current.filter((entry) => entry.id !== item.id)]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_DOWNLOADS);

    await AsyncStorage.setItem(DOWNLOADS_KEY, JSON.stringify(next));
    notifyListeners(next);
    if (nextEntry.status === 'completed' || nextEntry.status === 'failed') {
      void pushDownloadToCloud(nextEntry);
    }
  });
}

export function setDownloads(items: DownloadItem[]): Promise<void> {
  return enqueueDownloadsWrite(async () => {
    const sanitized = sanitize(items);
    await AsyncStorage.setItem(DOWNLOADS_KEY, JSON.stringify(sanitized));
    notifyListeners(sanitized);
  });
}

export function removeDownload(id: string): Promise<void> {
  cancelDownload(id); // stop active/queued download immediately
  deletedIds.add(id); // prevent upsertDownload from restoring this record
  return enqueueDownloadsWrite(async () => {
    const current = await getDownloads();
    const next = current.filter((entry) => entry.id !== id);
    await AsyncStorage.setItem(DOWNLOADS_KEY, JSON.stringify(next));
    notifyListeners(next);
    void removeDownloadFromCloud(id);
  });
}

export function clearDownloads(): Promise<void> {
  return enqueueDownloadsWrite(async () => {
    await AsyncStorage.removeItem(DOWNLOADS_KEY);
    notifyListeners([]);
    void clearCloudDownloads();
  });
}
