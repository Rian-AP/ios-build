import AsyncStorage from '@react-native-async-storage/async-storage';

import type { AnimeTitle } from '@/lib/api';
import { proxyImageUrl } from '@/lib/api';
import { clearCloudBookmarks, pushBookmarkToCloud, removeBookmarkFromCloud } from '@/lib/sync';

const BOOKMARKS_KEY = 'bookmarks_v1';
const MAX_BOOKMARKS = 500;
let writeQueue: Promise<void> = Promise.resolve();

export interface BookmarkItem {
  animeId: string;
  animeTitle: string;
  animeTitleByLanguage?: AnimeTitle | null;
  cover?: string | null;
  shikimoriId?: string | null;
  anilistId?: string | null;
  savedAt: number;
}

const enqueueWrite = (operation: () => Promise<void>) => {
  writeQueue = writeQueue.catch(() => undefined).then(operation);
  return writeQueue;
};

const sanitize = (value: unknown): BookmarkItem[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const entry = item as Partial<BookmarkItem>;
      if (!entry.animeId) return null;
      return {
        animeId: String(entry.animeId),
        animeTitle: String(entry.animeTitle || '').trim(),
        animeTitleByLanguage: entry.animeTitleByLanguage ?? null,
        cover: proxyImageUrl(entry.cover, entry.shikimoriId, entry.anilistId),
        shikimoriId: String(entry.shikimoriId || '').trim() || null,
        anilistId: String(entry.anilistId || '').trim() || null,
        savedAt: Number(entry.savedAt || 0),
      } as BookmarkItem;
    })
    .filter((item): item is BookmarkItem => Boolean(item))
    .slice(0, MAX_BOOKMARKS);
};

export async function getBookmarks(): Promise<BookmarkItem[]> {
  const raw = await AsyncStorage.getItem(BOOKMARKS_KEY);
  if (!raw) return [];
  try {
    return sanitize(JSON.parse(raw));
  } catch {
    return [];
  }
}

export async function isBookmarked(animeId: string): Promise<boolean> {
  const items = await getBookmarks();
  return items.some((item) => item.animeId === animeId);
}

export function addBookmark(item: Omit<BookmarkItem, 'savedAt'>): Promise<void> {
  return enqueueWrite(async () => {
    const current = await getBookmarks();
    if (current.some((b) => b.animeId === item.animeId)) return;
    const newItem: BookmarkItem = { ...item, savedAt: Date.now() };
    const next: BookmarkItem[] = [newItem, ...current].slice(0, MAX_BOOKMARKS);
    await AsyncStorage.setItem(BOOKMARKS_KEY, JSON.stringify(next));
    void pushBookmarkToCloud(newItem);
  });
}

export function removeBookmark(animeId: string): Promise<void> {
  return enqueueWrite(async () => {
    const current = await getBookmarks();
    const next = current.filter((item) => item.animeId !== animeId);
    await AsyncStorage.setItem(BOOKMARKS_KEY, JSON.stringify(next));
    void removeBookmarkFromCloud(animeId);
  });
}

export function clearBookmarks(): Promise<void> {
  return enqueueWrite(async () => {
    await AsyncStorage.removeItem(BOOKMARKS_KEY);
    await clearCloudBookmarks();
  });
}
