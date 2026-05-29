import type { AnimeTitle } from '@/lib/api';
import { supabase } from '@/lib/supabase';

export type CloudSettings = {
  themeMode: 'system' | 'light' | 'dark';
  accentHue: number;
  language: 'en' | 'ru';
};

type BookmarkItem = {
  animeId: string;
  animeTitle: string;
  animeTitleByLanguage?: AnimeTitle | null;
  cover?: string | null;
  savedAt: number;
};

type HistoryItem = {
  animeId: string;
  animeTitle: string;
  animeTitleByLanguage?: AnimeTitle;
  cover?: string | null;
  episodeId: string;
  episodeTitle: string;
  episodeNumber?: string | null;
  teamSlug?: string | null;
  quality?: string | null;
  positionSec?: number;
  durationSec?: number;
  progress?: number;
  savedAt: number;
};

const getSession = async () => {
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data.session;
  } catch {
    return null;
  }
};

// ─── Debounce helper for Realtime handlers ────────────────────────────────────

const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function debounced(key: string, ms: number, fn: () => void) {
  const existing = debounceTimers.get(key);
  if (existing) clearTimeout(existing);
  debounceTimers.set(key, setTimeout(() => {
    debounceTimers.delete(key);
    fn();
  }, ms));
}

// ─── Suppress Realtime after local clear ─────────────────────────────────────
// When we clear data locally and then delete from cloud, Supabase sends a
// Realtime event back to the same device. We suppress it to avoid restoring
// data that was just cleared.

const suppressUntil = new Map<string, number>();

export function suppressRealtimeFor(key: string, ms = 5000) {
  suppressUntil.set(key, Date.now() + ms);
}

export function isRealtimeSuppressed(key: string): boolean {
  const until = suppressUntil.get(key);
  if (!until) return false;
  if (Date.now() > until) {
    suppressUntil.delete(key);
    return false;
  }
  return true;
}

// ─── Bookmarks sync ───────────────────────────────────────────────────────────

export async function pushBookmarkToCloud(item: BookmarkItem): Promise<void> {
  const session = await getSession();
  if (!session || !supabase) return;
  try {
    await supabase.from('bookmarks').upsert({
      user_id: session.user.id,
      anime_id: item.animeId,
      anime_title: item.animeTitle,
      anime_title_by_language: item.animeTitleByLanguage ?? null,
      cover: item.cover ?? null,
      saved_at: item.savedAt,
    }, { onConflict: 'user_id,anime_id' });
  } catch {
    // silent
  }
}

export async function removeBookmarkFromCloud(animeId: string): Promise<void> {
  const session = await getSession();
  if (!session || !supabase) return;
  try {
    await supabase.from('bookmarks')
      .delete()
      .eq('user_id', session.user.id)
      .eq('anime_id', animeId);
  } catch {
    // silent
  }
}

export async function clearCloudBookmarks(): Promise<void> {
  const session = await getSession();
  if (!session || !supabase) return;
  suppressRealtimeFor('sync:bookmarks');
  try {
    await supabase.from('bookmarks').delete().eq('user_id', session.user.id);
  } catch {
    // silent
  }
}

export async function clearCloudHistory(): Promise<void> {
  const session = await getSession();
  if (!session || !supabase) return;
  suppressRealtimeFor('sync:history');
  try {
    await supabase.from('watch_history').delete().eq('user_id', session.user.id);
  } catch {
    // silent
  }
}

export async function clearCloudDownloads(): Promise<void> {
  const session = await getSession();
  if (!session || !supabase) return;
  suppressRealtimeFor('sync:downloads');
  try {
    await supabase.from('downloads_meta').delete().eq('user_id', session.user.id);
  } catch {
    // silent
  }
}

export async function fetchCloudBookmarks(): Promise<BookmarkItem[]> {
  const session = await getSession();
  if (!session || !supabase) return [];
  try {
    const { data, error } = await supabase
      .from('bookmarks')
      .select('anime_id, anime_title, anime_title_by_language, cover, saved_at')
      .eq('user_id', session.user.id)
      .order('saved_at', { ascending: false })
      .limit(500);
    if (error || !data) return [];
    return data.map((row) => ({
      animeId: String(row.anime_id),
      animeTitle: String(row.anime_title || ''),
      animeTitleByLanguage: row.anime_title_by_language ?? null,
      cover: row.cover ?? null,
      savedAt: Number(row.saved_at || 0),
    }));
  } catch {
    return [];
  }
}

// ─── History sync ─────────────────────────────────────────────────────────────

export async function pushHistoryToCloud(item: HistoryItem): Promise<void> {
  const session = await getSession();
  if (!session || !supabase) return;
  try {
    await supabase.from('watch_history').upsert({
      user_id: session.user.id,
      anime_id: item.animeId,
      anime_title: item.animeTitle,
      anime_title_by_language: item.animeTitleByLanguage ?? null,
      cover: item.cover ?? null,
      episode_id: item.episodeId,
      episode_title: item.episodeTitle,
      episode_number: item.episodeNumber ?? null,
      team_slug: item.teamSlug ?? null,
      quality: item.quality ?? null,
      position_sec: item.positionSec ?? 0,
      duration_sec: item.durationSec ?? 0,
      progress: item.progress ?? 0,
      saved_at: item.savedAt,
    }, { onConflict: 'user_id,anime_id' });
  } catch {
    // silent
  }
}

export async function fetchCloudHistory(): Promise<HistoryItem[]> {
  const session = await getSession();
  if (!session || !supabase) return [];
  try {
    const { data, error } = await supabase
      .from('watch_history')
      .select('*')
      .eq('user_id', session.user.id)
      .order('saved_at', { ascending: false })
      .limit(50);
    if (error || !data) return [];
    return data.map((row) => ({
      animeId: String(row.anime_id),
      animeTitle: String(row.anime_title || ''),
      animeTitleByLanguage: row.anime_title_by_language ?? undefined,
      cover: row.cover ?? null,
      episodeId: String(row.episode_id),
      episodeTitle: String(row.episode_title || ''),
      episodeNumber: row.episode_number ?? null,
      teamSlug: row.team_slug ?? null,
      quality: row.quality ?? null,
      positionSec: Number(row.position_sec || 0),
      durationSec: Number(row.duration_sec || 0),
      progress: Number(row.progress || 0),
      savedAt: Number(row.saved_at || 0),
    }));
  } catch {
    return [];
  }
}

// ─── Replace local with cloud (used by Realtime — cloud is source of truth) ──

export async function replaceLocalBookmarks(
  setLocalItems: (items: BookmarkItem[]) => Promise<void>,
): Promise<void> {
  const cloudItems = await fetchCloudBookmarks();
  await setLocalItems(cloudItems);
}

export async function replaceLocalHistory(
  setLocalItems: (items: HistoryItem[]) => Promise<void>,
): Promise<void> {
  const cloudItems = await fetchCloudHistory();
  await setLocalItems(cloudItems);
}

// ─── Full merge (on login / app resume) ──────────────────────────────────────
// Strategy: true merge by savedAt — newest item wins per animeId

export async function mergeCloudBookmarks(
  localItems: BookmarkItem[],
  setLocalItems: (items: BookmarkItem[]) => Promise<void>,
): Promise<BookmarkItem[]> {
  const session = await getSession();
  if (!session) return localItems;

  const cloudItems = await fetchCloudBookmarks();

  // Merge: newest savedAt wins per animeId
  const byId = new Map<string, BookmarkItem>();
  for (const item of [...cloudItems, ...localItems]) {
    const existing = byId.get(item.animeId);
    if (!existing || item.savedAt > existing.savedAt) {
      byId.set(item.animeId, item);
    }
  }

  const merged = Array.from(byId.values())
    .sort((a, b) => b.savedAt - a.savedAt)
    .slice(0, 500);

  await setLocalItems(merged);

  // Push local-only items to cloud
  const cloudIds = new Set(cloudItems.map((i) => i.animeId));
  for (const item of localItems) {
    if (!cloudIds.has(item.animeId)) {
      void pushBookmarkToCloud(item);
    }
  }

  return merged;
}

export async function mergeCloudHistory(
  localItems: HistoryItem[],
  setLocalItems: (items: HistoryItem[]) => Promise<void>,
): Promise<HistoryItem[]> {
  const session = await getSession();
  if (!session) return localItems;

  const cloudItems = await fetchCloudHistory();

  // Merge: newest savedAt wins per animeId
  const byId = new Map<string, HistoryItem>();
  for (const item of [...cloudItems, ...localItems]) {
    const existing = byId.get(item.animeId);
    if (!existing || item.savedAt > existing.savedAt) {
      byId.set(item.animeId, item);
    }
  }

  const merged = Array.from(byId.values())
    .sort((a, b) => b.savedAt - a.savedAt)
    .slice(0, 50);

  await setLocalItems(merged);

  // Push local-only items to cloud
  const cloudIds = new Set(cloudItems.map((i) => i.animeId));
  for (const item of localItems) {
    if (!cloudIds.has(item.animeId)) {
      void pushHistoryToCloud(item);
    }
  }

  return merged;
}

// ─── Settings sync ────────────────────────────────────────────────────────────

export async function pushSettingsToCloud(settings: CloudSettings): Promise<void> {
  const session = await getSession();
  if (!session || !supabase) return;
  try {
    await supabase.from('user_settings').upsert({
      user_id: session.user.id,
      theme_mode: settings.themeMode,
      accent_hue: settings.accentHue,
      language: settings.language,
      updated_at: Date.now(),
    }, { onConflict: 'user_id' });
  } catch {
    // silent
  }
}

export async function fetchCloudSettings(): Promise<CloudSettings | null> {
  const session = await getSession();
  if (!session || !supabase) return null;
  try {
    const { data, error } = await supabase
      .from('user_settings')
      .select('theme_mode, accent_hue, language')
      .eq('user_id', session.user.id)
      .single();
    if (error || !data) return null;
    const themeMode = data.theme_mode === 'light' || data.theme_mode === 'dark' ? data.theme_mode : 'system';
    const language = data.language === 'ru' ? 'ru' : 'en';
    const accentHue = Number(data.accent_hue);
    return {
      themeMode,
      language,
      accentHue: Number.isFinite(accentHue) ? accentHue : 258,
    };
  } catch {
    return null;
  }
}

// ─── Downloads metadata sync ──────────────────────────────────────────────────

type DownloadItemLike = {
  id: string; animeId: string; animeTitle: string;
  animeTitleByLanguage?: AnimeTitle; cover?: string | null;
  episodeId: string; episodeTitle: string; episodeNumber?: string | null;
  teamSlug?: string | null; teamName?: string | null;
  translationType?: string | null; quality?: string | null;
  status: string; remoteStreamUrl?: string | null;
  savedAt: number; updatedAt: number;
};

export async function pushDownloadToCloud(item: DownloadItemLike): Promise<void> {
  const session = await getSession();
  if (!session || !supabase) return;
  try {
    await supabase.from('downloads_meta').upsert({
      user_id: session.user.id,
      download_id: item.id,
      anime_id: item.animeId,
      anime_title: item.animeTitle,
      anime_title_by_language: item.animeTitleByLanguage ?? null,
      cover: item.cover ?? null,
      episode_id: item.episodeId,
      episode_title: item.episodeTitle,
      episode_number: item.episodeNumber ?? null,
      team_slug: item.teamSlug ?? null,
      team_name: item.teamName ?? null,
      translation_type: item.translationType ?? null,
      quality: item.quality ?? null,
      status: item.status,
      remote_stream_url: item.remoteStreamUrl ?? null,
      saved_at: item.savedAt,
      updated_at: item.updatedAt,
    }, { onConflict: 'user_id,download_id' });
  } catch {
    // silent
  }
}

export async function removeDownloadFromCloud(downloadId: string): Promise<void> {
  const session = await getSession();
  if (!session || !supabase) return;
  try {
    await supabase.from('downloads_meta')
      .delete()
      .eq('user_id', session.user.id)
      .eq('download_id', downloadId);
  } catch {
    // silent
  }
}

// Backfill remote_stream_url for existing cloud records that were saved before
// this field was added. Runs once on login, only updates records missing the URL.
export async function backfillDownloadStreamUrls(): Promise<void> {
  const session = await getSession();
  if (!session || !supabase) return;

  // Import here to avoid circular dependency
  const { getDownloads } = await import('@/lib/downloads');
  const localItems = await getDownloads();

  // Only items that have a remoteStreamUrl locally
  const itemsWithUrl = localItems.filter(
    (item) => String(item.remoteStreamUrl || '').trim().length > 0
  );
  if (itemsWithUrl.length === 0) return;

  // Fetch cloud records that are missing remote_stream_url
  try {
    const { data } = await supabase
      .from('downloads_meta')
      .select('download_id, remote_stream_url')
      .eq('user_id', session.user.id)
      .is('remote_stream_url', null);

    if (!data || data.length === 0) return;

    const cloudMissingIds = new Set(data.map((row) => String(row.download_id)));

    // Push only the ones that are missing in cloud
    for (const item of itemsWithUrl) {
      if (!cloudMissingIds.has(item.id)) continue;
      await supabase.from('downloads_meta')
        .update({ remote_stream_url: item.remoteStreamUrl })
        .eq('user_id', session.user.id)
        .eq('download_id', item.id);
    }
  } catch {
    // silent — backfill is best-effort
  }
}

export async function fetchCloudDownloads(): Promise<DownloadItemLike[]> {
  const session = await getSession();
  if (!session || !supabase) return [];
  try {
    const { data, error } = await supabase
      .from('downloads_meta')
      .select('*')
      .eq('user_id', session.user.id)
      .order('updated_at', { ascending: false })
      .limit(200);
    if (error || !data) return [];
    return data.map((row) => ({
      id: String(row.download_id),
      animeId: String(row.anime_id),
      animeTitle: String(row.anime_title || ''),
      animeTitleByLanguage: row.anime_title_by_language ?? undefined,
      cover: row.cover ?? null,
      episodeId: String(row.episode_id),
      episodeTitle: String(row.episode_title || ''),
      episodeNumber: row.episode_number ?? null,
      teamSlug: row.team_slug ?? null,
      teamName: row.team_name ?? null,
      translationType: row.translation_type ?? null,
      quality: row.quality ?? null,
      status: row.status ?? 'failed',
      remoteStreamUrl: row.remote_stream_url ?? null,
      savedAt: Number(row.saved_at || 0),
      updatedAt: Number(row.updated_at || 0),
    }));
  } catch {
    return [];
  }
}

export async function mergeCloudDownloads(
  localItems: any[],
  setLocalItems: (items: any[]) => Promise<void>,
  onDeleteLocalItem?: (item: any) => void
): Promise<any[]> {
  const session = await getSession();
  if (!session) return localItems;

  const cloudItems = await fetchCloudDownloads();

  if (cloudItems.length === 0) {
    for (const item of localItems) {
      if (item.status === 'completed' || item.status === 'failed') {
        void pushDownloadToCloud(item);
      }
    }
    return localItems;
  }

  const localMap = new Map(localItems.map(item => [item.id, item]));
  const cloudMap = new Map(cloudItems.map(item => [item.id, item]));

  const mergedList: any[] = [];
  let changed = false;

  for (const localItem of localItems) {
    if (cloudMap.has(localItem.id)) {
      mergedList.push(localItem);
    } else {
      changed = true;
      onDeleteLocalItem?.(localItem);
    }
  }

  for (const cloudItem of cloudItems) {
    if (!localMap.has(cloudItem.id)) {
      mergedList.push({
        id: cloudItem.id,
        animeId: cloudItem.animeId,
        animeTitle: cloudItem.animeTitle,
        animeTitleByLanguage: cloudItem.animeTitleByLanguage,
        cover: cloudItem.cover ?? null,
        episodeId: cloudItem.episodeId,
        episodeTitle: cloudItem.episodeTitle,
        episodeNumber: cloudItem.episodeNumber ?? null,
        teamSlug: cloudItem.teamSlug ?? null,
        teamName: cloudItem.teamName ?? null,
        translationType: cloudItem.translationType ?? null,
        quality: cloudItem.quality ?? null,
        status: 'failed',
        progress: 0,
        localPlaylistUri: null,
        storageDirUri: null,
        remoteStreamUrl: cloudItem.remoteStreamUrl ?? null,
        bytesDownloaded: 0,
        totalBytes: 0,
        error: 'File not downloaded on this device',
        savedAt: cloudItem.savedAt,
        updatedAt: cloudItem.updatedAt,
      });
      changed = true;
    }
  }

  if (changed) {
    const sorted = mergedList.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 200);
    await setLocalItems(sorted);
    return sorted;
  }

  return localItems;
}

export async function replaceLocalDownloads(
  localItems: any[],
  setLocalItems: (items: any[]) => Promise<void>,
  onDeleteLocalItem?: (item: any) => void
): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const cloudItems = await fetchCloudDownloads();
  const localMap = new Map(localItems.map(item => [item.id, item]));
  const cloudMap = new Map(cloudItems.map(item => [item.id, item]));

  const mergedList: any[] = [];
  let changed = false;

  for (const localItem of localItems) {
    if (cloudMap.has(localItem.id)) {
      mergedList.push(localItem);
    } else {
      changed = true;
      onDeleteLocalItem?.(localItem);
    }
  }

  for (const cloudItem of cloudItems) {
    if (!localMap.has(cloudItem.id)) {
      mergedList.push({
        id: cloudItem.id,
        animeId: cloudItem.animeId,
        animeTitle: cloudItem.animeTitle,
        animeTitleByLanguage: cloudItem.animeTitleByLanguage,
        cover: cloudItem.cover ?? null,
        episodeId: cloudItem.episodeId,
        episodeTitle: cloudItem.episodeTitle,
        episodeNumber: cloudItem.episodeNumber ?? null,
        teamSlug: cloudItem.teamSlug ?? null,
        teamName: cloudItem.teamName ?? null,
        translationType: cloudItem.translationType ?? null,
        quality: cloudItem.quality ?? null,
        status: 'failed',
        progress: 0,
        localPlaylistUri: null,
        storageDirUri: null,
        remoteStreamUrl: cloudItem.remoteStreamUrl ?? null,
        bytesDownloaded: 0,
        totalBytes: 0,
        error: 'File not downloaded on this device',
        savedAt: cloudItem.savedAt,
        updatedAt: cloudItem.updatedAt,
      });
      changed = true;
    }
  }

  if (changed) {
    const sorted = mergedList.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 200);
    await setLocalItems(sorted);
  }
}
