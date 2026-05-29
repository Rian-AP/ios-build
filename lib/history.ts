import AsyncStorage from '@react-native-async-storage/async-storage';

import { api, getTitleText, proxyImageUrl, type AnimeTitle, type ApiLanguage } from '@/lib/api';
import { clearCloudHistory, pushHistoryToCloud } from '@/lib/sync';

const HISTORY_KEY = 'stream_history_v1';
const MAX_ITEMS = 50;
let historyWriteQueue: Promise<void> = Promise.resolve();

export interface HistoryItem {
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
  quality?: string | null;
  positionSec?: number;
  durationSec?: number;
  progress?: number;
  savedAt: number;
}

const toNonNegativeFiniteNumber = (value: unknown) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, numeric);
};

const toProgressValue = (value: unknown, positionSec: number, durationSec: number) => {
  const byDuration = durationSec > 0 ? positionSec / durationSec : 0;
  const raw = Number.isFinite(byDuration) && byDuration > 0 ? byDuration : Number(value);
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(raw, 1));
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

const inferEpisodeNumber = (value: unknown): string | null => {
  const text = String(value || '').trim();
  if (!text) return null;

  const match = text.match(/(?:#|episode|ep|эпизод|эп|серия)\s*#?\s*([0-9]+(?:\.[0-9]+)?|\?)/i);
  return match?.[1] || null;
};

const sanitize = (value: unknown): HistoryItem[] => {
  if (!Array.isArray(value)) return [];

  const mapped = value
    .map((item) => {
      const entry = item as Partial<HistoryItem>;
      if (!entry.animeId || !entry.episodeId) return null;
      const animeTitleByLanguage = sanitizeTitle(entry.animeTitleByLanguage);
      const legacyTitle = String(entry.animeTitle || '').trim();
      const positionSec = toNonNegativeFiniteNumber(entry.positionSec);
      const durationSec = toNonNegativeFiniteNumber(entry.durationSec);
      const teamSlug = String(entry.teamSlug || '').trim() || null;
      const quality = String(entry.quality || '').trim() || null;
      return {
        animeId: String(entry.animeId),
        animeTitle:
          legacyTitle ||
          animeTitleByLanguage?.en ||
          animeTitleByLanguage?.ru ||
          animeTitleByLanguage?.jp ||
          '',
        animeTitleByLanguage,
        cover: proxyImageUrl(entry.cover, entry.shikimoriId, entry.anilistId),
        shikimoriId: String(entry.shikimoriId || '').trim() || null,
        anilistId: String(entry.anilistId || '').trim() || null,
        episodeId: String(entry.episodeId),
        episodeTitle: String(entry.episodeTitle || ''),
        episodeNumber: entry.episodeNumber != null
          ? String(entry.episodeNumber)
          : inferEpisodeNumber(entry.episodeTitle),
        teamSlug,
        quality,
        positionSec,
        durationSec,
        progress: toProgressValue(entry.progress, positionSec, durationSec),
        savedAt: Number(entry.savedAt || Date.now()),
      } as HistoryItem;
    })
    .filter((item): item is HistoryItem => Boolean(item));

  const uniqueByAnimeId = new Map<string, HistoryItem>();
  for (const item of mapped) {
    const existing = uniqueByAnimeId.get(item.animeId);
    if (!existing || item.savedAt >= existing.savedAt) {
      uniqueByAnimeId.set(item.animeId, item);
    }
  }

  return Array.from(uniqueByAnimeId.values())
    .sort((left, right) => right.savedAt - left.savedAt)
    .slice(0, MAX_ITEMS);
};

export async function getHistory(): Promise<HistoryItem[]> {
  const raw = await AsyncStorage.getItem(HISTORY_KEY);
  if (!raw) return [];

  try {
    return sanitize(JSON.parse(raw));
  } catch {
    return [];
  }
}

const hasStructuredTitle = (item: HistoryItem) =>
  Boolean(item.animeTitleByLanguage?.en || item.animeTitleByLanguage?.ru || item.animeTitleByLanguage?.jp);

const needsHydration = (item: HistoryItem) =>
  !hasStructuredTitle(item) || !item.cover;

export async function getHydratedHistory(): Promise<HistoryItem[]> {
  const current = await getHistory();
  const slugsToHydrate = Array.from(
    new Set(current.filter(needsHydration).map((item) => item.animeId))
  );

  if (slugsToHydrate.length === 0) {
    return current;
  }

  const detailsBySlug = new Map<string, Awaited<ReturnType<typeof api.anime>>>();
  const results = await Promise.allSettled(
    slugsToHydrate.map(async (slug) => {
      const details = await api.anime(slug);
      detailsBySlug.set(slug, details);
    })
  );

  if (!results.some((result) => result.status === 'fulfilled')) {
    return current;
  }

  let changed = false;
  const next = current.map((item) => {
    if (!needsHydration(item)) {
      return item;
    }

    const details = detailsBySlug.get(item.animeId);
    if (!details) {
      return item;
    }

    const shikimoriId = details.shikimoriHref
      ? String(details.shikimoriHref).split('/').pop() || null
      : item.shikimoriId || null;
    const anilistId = details.anilistHref
      ? String(details.anilistHref).split('/').pop() || null
      : item.anilistId || null;

    const resolvedCover = item.cover || proxyImageUrl(details.cover, shikimoriId, anilistId);

    changed = true;
    return {
      ...item,
      animeTitle: getTitleText(details.title, 'en', item.animeTitle),
      animeTitleByLanguage: details.title,
      shikimoriId,
      anilistId,
      cover: resolvedCover,
    };
  });

  if (changed) {
    await enqueueHistoryWrite(() => AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next)));
  }

  return next;
}

type HistoryTitleLike = Pick<HistoryItem, 'animeTitle'> & {
  animeTitleByLanguage?: HistoryItem['animeTitleByLanguage'];
};

type HistoryEpisodeLike = Pick<HistoryItem, 'episodeTitle'> & {
  episodeNumber?: HistoryItem['episodeNumber'];
};

export function getHistoryAnimeTitle(item: HistoryTitleLike, language: ApiLanguage, fallback: string) {
  return getTitleText(
    item.animeTitleByLanguage || { en: item.animeTitle, ru: item.animeTitle },
    language,
    fallback
  );
}

const normalizeEpisodeText = (value: string) =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}?]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const isGeneratedEpisodeTitle = (value: string, number: string | null) => {
  if (!number) return false;
  const normalized = normalizeEpisodeText(value);
  const normalizedNumber = normalizeEpisodeText(number);

  return [
    `episode ${normalizedNumber}`,
    `ep ${normalizedNumber}`,
    `эпизод ${normalizedNumber}`,
    `эп ${normalizedNumber}`,
    `${normalizedNumber} episode ${normalizedNumber}`,
    `${normalizedNumber} ep ${normalizedNumber}`,
    `${normalizedNumber} эпизод ${normalizedNumber}`,
    `${normalizedNumber} эп ${normalizedNumber}`,
  ].includes(normalized);
};

export function getHistoryEpisodeTitle(
  item: HistoryEpisodeLike,
  formatFallback: (number: string) => string,
  unknownEpisode: string
) {
  const number = item.episodeNumber || inferEpisodeNumber(item.episodeTitle);
  const title = String(item.episodeTitle || '').trim();

  if (!title || isGeneratedEpisodeTitle(title, number)) {
    return number ? formatFallback(number) : unknownEpisode;
  }

  return title;
}

export async function clearHistory(): Promise<void> {
  await enqueueHistoryWrite(() => AsyncStorage.removeItem(HISTORY_KEY));
  await clearCloudHistory();
}

const enqueueHistoryWrite = (operation: () => Promise<void>) => {
  historyWriteQueue = historyWriteQueue.catch(() => undefined).then(operation);
  return historyWriteQueue;
};

export function saveHistory(item: Omit<HistoryItem, 'savedAt'>): Promise<void> {
  return enqueueHistoryWrite(async () => {
    const current = await getHistory();
    const positionSec = toNonNegativeFiniteNumber(item.positionSec);
    const durationSec = toNonNegativeFiniteNumber(item.durationSec);
    const next: HistoryItem[] = [
      {
        ...item,
        positionSec,
        durationSec,
        progress: toProgressValue(item.progress, positionSec, durationSec),
        savedAt: Date.now(),
      },
      ...current.filter(
        (entry) => entry.animeId !== item.animeId
      ),
    ].slice(0, MAX_ITEMS);

    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    void pushHistoryToCloud(next[0]);
  });
}
