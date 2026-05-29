const API_BASE_URL =
  (process.env.EXPO_PUBLIC_API_BASE_URL || 'https://apicursach.vercel.app').replace(/\/+$/, '');
const REQUEST_TIMEOUT_MS = 12_000;

export interface AnimeTitle {
  ru?: string | null;
  en?: string | null;
  jp?: string | null;
}

export type ApiLanguage = 'en' | 'ru';

const titleFallback: Record<ApiLanguage, string> = {
  en: 'Untitled',
  ru: 'Без названия',
};

export function getTitleText(title: AnimeTitle, language: ApiLanguage = 'en', fallback?: string): string {
  const resolvedFallback = fallback || titleFallback[language];
  if (language === 'ru') {
    return title.ru || title.en || title.jp || resolvedFallback;
  }
  return title.en || title.ru || title.jp || resolvedFallback;
}

export interface AnimeCard {
  id: string;
  animeId: number;
  slug: string;
  title: AnimeTitle;
  cover?: string | null;
  episode?: string | null;
  synopsis?: string | null;
  dub?: boolean;
  studio?: string | null;
  status?: string | null;
  type?: string | null;
  restored?: boolean;
}

export interface HomeResponse {
  hero: AnimeCard[];
  highlight: AnimeCard[];
  latest: AnimeCard[];
}

export interface EpisodeListItem {
  id: string;
  animeId: number;
  title: string;
  episodeNumber: string;
  season?: string | null;
  itemNumber?: number | null;
  createdAt?: string | null;
}

export interface RelatedAnimeItem {
  relationType: string;
  slug: string;
  animeId?: number | null;
  title: AnimeTitle;
  cover?: string | null;
}

export interface AnimeDetails {
  id: string;
  animeId: number;
  slug: string;
  title: AnimeTitle;
  cover?: string | null;
  background?: string | null;
  description?: string | null;
  status?: string | null;
  type?: string | null;
  ageRating?: string | null;
  releaseDate?: string | null;
  score?: string | null;
  shikimoriHref?: string | null;
  anilistHref?: string | null;
  restored?: boolean;
  sourceManga?: {
    id?: number | null;
    slug: string;
    title: AnimeTitle;
  } | null;
  relatedAnime: RelatedAnimeItem[];
  genres: Array<{ id: number; name: string }>;
}

export interface AnimePageResponse {
  details: AnimeDetails;
  episodes: EpisodeListItem[];
}

export interface EpisodePlayer {
  id: string;
  player: string;
  translationType: string;
  teamName: string;
  teamSlug?: string | null;
  views?: number | null;
  src?: string | null;
  srcResolved?: string | null;
  qualityDefault?: string | null;
  qualityLinks: Record<string, string>;
}

export interface EpisodePlaybackResponse {
  id: string;
  animeId: number;
  title: string;
  episodeNumber: string;
  season?: string | null;
  players: EpisodePlayer[];
  resolvedPlayerIds: string[];
  resolveMode: string;
}

type RawCover = {
  original?: string | null;
  default?: string | null;
  md?: string | null;
  thumbnail?: string | null;
};

type RawDocNode = {
  type?: string;
  text?: string;
  content?: RawDocNode[];
};

function extractSummaryText(node?: RawDocNode | null): string {
  if (!node) return '';
  if (node.type === 'text') return node.text || '';
  if (Array.isArray(node.content)) {
    return node.content
      .map((child) => extractSummaryText(child))
      .filter(Boolean)
      .join(' ');
  }
  return '';
}

type RawAnimeSummary = {
  id: number | string;
  name?: string | null;
  rus_name?: string | null;
  eng_name?: string | null;
  slug?: string | null;
  slug_url?: string | null;
  description?: string | null;
  cover?: RawCover | null;
  background?: { url?: string | null; filename?: string | null } | null;
  summary?: RawDocNode | null;
  genres?: Array<{ id?: number; name?: string | null; adult?: boolean; alert?: boolean }> | null;
  status?: { label?: string | null } | null;
  type?: { label?: string | null } | null;
  ageRestriction?: { label?: string | null } | null;
  releaseDateString?: string | null;
  rating?: {
    averageFormated?: string | null;
    average?: string | number | null;
  } | null;
  shiki_rate?: string | number | null;
  shikimori_href?: string | null;
  anilist_href?: string | null;
  restored?: boolean;
  source_manga?: RawRelatedMedia | null;
  related_anime?: Array<{
    relation_type?: string | null;
    media?: RawRelatedMedia | null;
  }> | null;
  metadata?: {
    latest_items?: {
      items?: RawEpisodeListItem[];
    } | null;
  } | null;
};

type RawRelatedMedia = {
  id?: number | string | null;
  slug?: string | null;
  slug_url?: string | null;
  model?: string | null;
  name?: string | null;
  rus_name?: string | null;
  eng_name?: string | null;
  cover?: RawCover | null;
  shikimori_href?: string | null;
  anilist_href?: string | null;
};

type RawEpisodeListItem = {
  id: number | string;
  anime_id: number | string;
  name?: string | null;
  number?: string | number | null;
  number_secondary?: string | number | null;
  season?: string | number | null;
  item_number?: number | null;
  created_at?: string | null;
  players?: RawPlayer[] | null;
};

type RawTeam = {
  name?: string | null;
  slug?: string | null;
  slug_url?: string | null;
};

type RawPlayer = {
  id: number | string;
  player?: string | null;
  translation_type?: { label?: string | null } | null;
  team?: RawTeam | null;
  views?: number | null;
  src?: string | null;
  src_resolved?: string | null;
  quality_default?: string | number | null;
  quality_links?: Record<string, Array<{ src?: string | null }> | undefined> | null;
};

type RawResponse<T> = {
  data: T;
  meta?: {
    resolved_player_ids?: Array<number | string>;
    resolve_mode?: string;
    [key: string]: unknown;
  };
};

type RawTopViewsGroup = {
  key?: string;
  label?: string | null;
  popularity?: string | number | null;
  metric?: string | null;
  count?: number | null;
  items?: RawAnimeSummary[] | null;
};

type RawTopViewsPayload = {
  title?: string | null;
  time?: string | null;
  time_label?: string | null;
  page?: number | null;
  groups?: RawTopViewsGroup[] | null;
};

interface ErrorPayload {
  message?: string;
  error?: string;
  data?: {
    toast?: {
      message?: string;
    };
  };
}

type I18nStrings = {
  requestFailed: (status: number) => string;
  requestTimeout: (seconds: number) => string;
};

const i18nEn: I18nStrings = {
  requestFailed: (status) => `Request failed (${status})`,
  requestTimeout: (seconds) => `Request timed out after ${seconds}s`,
};

const i18nRu: I18nStrings = {
  requestFailed: (status) => `Ошибка запроса (${status})`,
  requestTimeout: (seconds) => `Время ожидания истекло (${seconds}с)`,
};

const getI18n = (lang: ApiLanguage): I18nStrings => (lang === 'ru' ? i18nRu : i18nEn);

const apiLabelTranslations: Record<string, { en: string; ru: string }> = {
  'анонс': { en: 'Announced', ru: 'Анонс' },
  'вышел': { en: 'Released', ru: 'Вышел' },
  'завершен': { en: 'Completed', ru: 'Завершён' },
  'онгоинг': { en: 'Ongoing', ru: 'Онгоинг' },
  'тв сериал': { en: 'TV Series', ru: 'TV Сериал' },
  'tv сериал': { en: 'TV Series', ru: 'TV Сериал' },
  'тв спешл': { en: 'TV Special', ru: 'ТВ Спэшл' },
  'фильм': { en: 'Movie', ru: 'Фильм' },
  'спешл': { en: 'Special', ru: 'Спешл' },
  'полнометражный фильм': { en: 'Movie', ru: 'Полнометражный фильм' },
  'озвучка': { en: 'Dub', ru: 'Озвучка' },
  'субтитры': { en: 'Subtitles', ru: 'Субтитры' },
  'полноценный эпизод': { en: 'Full Episode', ru: 'Полноценный эпизод' },
  'продолжение': { en: 'Sequel', ru: 'Продолжение' },
  'предыстория': { en: 'Prequel', ru: 'Предыстория' },
  'связанное': { en: 'Related', ru: 'Связанное' },
  'связанный тайтл': { en: 'Related', ru: 'Связанный тайтл' },
  'кроссовер': { en: 'Crossover', ru: 'Кроссовер' },
  'другое': { en: 'Other', ru: 'Другое' },
  'альтернативная версия': { en: 'Alternate Version', ru: 'Альтернативная версия' },
  'альтернативный сеттинг': { en: 'Alternate Setting', ru: 'Альтернативный сеттинг' },
  'адаптация': { en: 'Adaptation', ru: 'Адаптация' },
  'спин-офф': { en: 'Spin-off', ru: 'Спин-офф' },
  'неизвестно': { en: 'Unknown', ru: 'Неизвестно' },
  'неизвестный': { en: 'Unknown', ru: 'Неизвестный' },
};

const russianMonthNamesEn: Record<string, string> = {
  января: 'January',
  февраля: 'February',
  марта: 'March',
  апреля: 'April',
  мая: 'May',
  июня: 'June',
  июля: 'July',
  августа: 'August',
  сентября: 'September',
  октября: 'October',
  ноября: 'November',
  декабря: 'December',
};

const normalizeApiLabel = (value: string) =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const translateRussianDateToEnglish = (value: string) => {
  let output = value.replace(/\s*г\.\s*$/u, '').trim();
  for (const [ruMonth, enMonth] of Object.entries(russianMonthNamesEn)) {
    output = output.replace(new RegExp(`\\b${ruMonth}\\b`, 'iu'), enMonth);
  }
  return output;
};

export function getApiLabelText(value?: string | null, language: ApiLanguage = 'en'): string | null {
  const text = String(value || '').trim();
  if (!text) return null;

  const knownLabel = apiLabelTranslations[normalizeApiLabel(text)];
  if (knownLabel) {
    return knownLabel[language];
  }

  if (language === 'en') {
    return translateRussianDateToEnglish(text);
  }

  return text;
}

export function getApiErrorMessage(error: unknown, language: ApiLanguage, fallback: string): string {
  if (!(error instanceof Error)) {
    return fallback;
  }

  const i18n = getI18n(language);
  const message = error.message.trim();
  const requestFailed = message.match(/^Request failed \((\d+)\)$/i);
  if (requestFailed) {
    return i18n.requestFailed(Number(requestFailed[1]));
  }

  const requestTimeout = message.match(/^Request timed out after (\d+(?:\.\d+)?)s$/i);
  if (requestTimeout) {
    return i18n.requestTimeout(Number(requestTimeout[1]));
  }

  if (message === 'Not Found') {
    return language === 'ru' ? 'Не найдено' : 'Not Found';
  }

  return message || fallback;
}

const buildUrl = (path: string) => `${API_BASE_URL}${path}`;
const encodePath = (value: string) => encodeURIComponent(value);

const episodeOrderValue = (episode: EpisodeListItem) => {
  if (episode.itemNumber != null) return episode.itemNumber;
  const numeric = Number(episode.episodeNumber);
  return Number.isFinite(numeric) ? numeric : 0;
};

export const proxyImageUrl = (
  url?: string | null,
  shikimoriId?: string | null,
  anilistId?: string | null
): string | null => {
  // Если нет прямого URL, но есть anilistId — строим фолбек через прокси
  if (!url) {
    if (anilistId) {
      return `${API_BASE_URL}/img?al=${encodeURIComponent(anilistId)}`;
    }
    return null;
  }

  // Если URL уже проксирован, возвращаем как есть
  if (url.includes(`${API_BASE_URL}/img?`)) {
    return url;
  }

  if (url.includes('hentaicdn.org')) {
    const parts = [`${API_BASE_URL}/img?u=${encodeURIComponent(url)}`];
    if (shikimoriId) parts.push(`shiki=${encodeURIComponent(shikimoriId)}`);
    if (anilistId) parts.push(`al=${encodeURIComponent(anilistId)}`);
    return parts.join('&');
  }
  return url;
};

const pickCover = (cover?: RawCover | null, shikimoriId?: string | null, anilistId?: string | null) =>
  proxyImageUrl(cover?.original || cover?.md || cover?.default || cover?.thumbnail || null, shikimoriId, anilistId);

const buildTitle = (item: {
  rus_name?: string | null;
  eng_name?: string | null;
  name?: string | null;
}) => ({
  ru: item.rus_name || null,
  en: item.eng_name || item.name || null,
  jp: item.name || null,
});

const episodeLabel = (episode?: RawEpisodeListItem | null) => {
  if (!episode) return null;
  if (episode.number) return String(episode.number);
  return null;
};

const hasDub = (episode?: RawEpisodeListItem | null) =>
  Array.isArray(episode?.players) &&
  episode.players.some((player) => player?.translation_type?.label === 'Озвучка');

const latestStudioName = (episode?: RawEpisodeListItem | null) => {
  if (!Array.isArray(episode?.players)) {
    return null;
  }

  const preferredPlayer =
    episode.players.find((player) => player?.translation_type?.label === 'Озвучка' && player?.team?.name) ||
    episode.players.find((player) => player?.team?.name);

  return preferredPlayer?.team?.name || null;
};

function mapAnimeCard(item: RawAnimeSummary): AnimeCard {
  const latestEpisode = item.metadata?.latest_items?.items?.[0] || null;
  const routeKey = String(item.slug_url || item.slug || item.id);
  const shikimoriId = item.shikimori_href
    ? String(item.shikimori_href).split('/').pop() || null
    : null;
  const anilistId = item.anilist_href
    ? String(item.anilist_href).split('/').pop() || null
    : null;

  return {
    id: routeKey,
    animeId: Number(item.id),
    slug: routeKey,
    title: buildTitle(item),
    cover: pickCover(item.cover, shikimoriId, anilistId),
    episode: episodeLabel(latestEpisode),
    synopsis: item.description || null,
    dub: hasDub(latestEpisode),
    studio: latestStudioName(latestEpisode),
    status: item.status?.label || null,
    type: item.type?.label || null,
    restored: Boolean(item.restored),
  };
}

function mapEpisodeListItem(item: RawEpisodeListItem): EpisodeListItem {
  const number = String(item.number || '?');
  const title = String(item.name || '').trim();

  return {
    id: String(item.id),
    animeId: Number(item.anime_id),
    title,
    episodeNumber: number,
    season: item.season != null ? String(item.season) : null,
    itemNumber: item.item_number ?? null,
    createdAt: item.created_at || null,
  };
}

function mapRelatedAnime(items?: RawAnimeSummary['related_anime']): RelatedAnimeItem[] {
  if (!Array.isArray(items)) return [];

  return items
    .filter((entry) => (entry?.media?.slug_url || entry?.media?.slug) && entry?.media?.model === 'anime')
    .map((entry) => {
      const media = entry?.media;
      const shikimoriId = media?.shikimori_href
        ? String(media.shikimori_href).split('/').pop() || null
        : null;
      const anilistId = media?.anilist_href
        ? String(media.anilist_href).split('/').pop() || null
        : null;
      return {
        relationType: String(entry?.relation_type || 'Связанный тайтл'),
        slug: String(media?.slug_url || media?.slug || ''),
        animeId: media?.id != null ? Number(media.id) : null,
        title: buildTitle({
          rus_name: media?.rus_name,
          eng_name: media?.eng_name,
          name: media?.name,
        }),
        cover: pickCover(media?.cover, shikimoriId, anilistId),
      };
    });
}

function mapAnimeDetails(item: RawAnimeSummary): AnimeDetails {
  const routeKey = String(item.slug_url || item.slug || item.id);
  const shikimoriId = item.shikimori_href
    ? String(item.shikimori_href).split('/').pop() || null
    : null;
  const anilistId = item.anilist_href
    ? String(item.anilist_href).split('/').pop() || null
    : null;
  const numericScore =
    item.rating?.averageFormated ||
    (item.rating?.average != null ? String(item.rating.average) : null) ||
    (item.shiki_rate != null ? String(item.shiki_rate) : null);

  return {
    id: routeKey,
    animeId: Number(item.id),
    slug: routeKey,
    title: buildTitle(item),
    cover: pickCover(item.cover, shikimoriId, anilistId),
    background: proxyImageUrl(item.background?.url || null, shikimoriId, anilistId),
    description: item.summary ? extractSummaryText(item.summary).trim() || null : item.description || null,
    status: item.status?.label || null,
    type: item.type?.label || null,
    ageRating: item.ageRestriction?.label || null,
    releaseDate: item.releaseDateString || null,
    score: numericScore,
    shikimoriHref: item.shikimori_href || null,
    anilistHref: item.anilist_href || null,
    restored: Boolean(item.restored),
    sourceManga: item.source_manga
      ? {
          id: item.source_manga.id != null ? Number(item.source_manga.id) : null,
          slug: String(item.source_manga.slug_url || item.source_manga.slug || ''),
          title: buildTitle({
            rus_name: item.source_manga.rus_name,
            eng_name: item.source_manga.eng_name,
            name: item.source_manga.name,
          }),
        }
      : null,
    relatedAnime: mapRelatedAnime(item.related_anime),
    genres: Array.isArray(item.genres)
      ? item.genres
          .filter((g) => g.id != null && g.name)
          .map((g) => ({ id: Number(g.id), name: String(g.name) }))
      : [],
  };
}

function mapQualityLinks(input?: RawPlayer['quality_links']): Record<string, string> {
  const output: Record<string, string> = {};

  if (!input || typeof input !== 'object') {
    return output;
  }

  for (const [quality, entries] of Object.entries(input)) {
    const first = Array.isArray(entries) ? entries.find((entry) => typeof entry?.src === 'string') : null;
    if (first?.src) {
      output[String(quality)] = first.src;
    }
  }

  return output;
}

function mapEpisodePlayer(item: RawPlayer): EpisodePlayer {
  const qualityLinks = mapQualityLinks(item.quality_links);

  return {
    id: String(item.id),
    player: String(item.player || ''),
    translationType: String(item.translation_type?.label || ''),
    teamName: String(item.team?.name || ''),
    teamSlug: item.team?.slug_url || item.team?.slug || null,
    views: item.views ?? null,
    src: item.src || null,
    srcResolved: item.src_resolved || null,
    qualityDefault:
      item.quality_default != null ? String(item.quality_default) : Object.keys(qualityLinks)[0] || null,
    qualityLinks,
  };
}

function buildHeroCards(groups?: RawTopViewsGroup[] | null, limit = Number.POSITIVE_INFINITY): AnimeCard[] {
  if (!Array.isArray(groups) || limit <= 0) {
    return [];
  }

  const buckets = groups.map((group) =>
    Array.isArray(group?.items) ? group.items.map(mapAnimeCard) : []
  );
  const seen = new Set<string>();
  const output: AnimeCard[] = [];
  let depth = 0;

  while (output.length < limit) {
    let foundAny = false;

    for (const bucket of buckets) {
      const item = bucket[depth];
      if (!item) {
        continue;
      }

      foundAny = true;
      if (seen.has(item.id)) {
        continue;
      }

      seen.add(item.id);
      output.push(item);
      if (output.length >= limit) {
        break;
      }
    }

    if (!foundAny) {
      break;
    }

    depth += 1;
  }

  return output;
}

export class DiscoveringError extends Error {
  constructor() {
    super('discovering');
    this.name = 'DiscoveringError';
  }
}

async function request<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(buildUrl(path), { signal: controller.signal });
    const data = (await response.json().catch(() => null)) as T | ErrorPayload | null;

    if (!response.ok) {
      if ((data as { discovering?: boolean } | null)?.discovering) {
        throw new DiscoveringError();
      }
      const message =
        (data as ErrorPayload | null)?.message ||
        (data as ErrorPayload | null)?.error ||
        (data as ErrorPayload | null)?.data?.toast?.message ||
        `Request failed (${response.status})`;
      throw new Error(message);
    }

    if ((data as ErrorPayload | null)?.data?.toast?.message === 'Not Found') {
      throw new Error('Not Found');
    }

    return data as T;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

type AnimeHints = {
  cover?: string;
  name?: string;
  rus?: string;
  eng?: string;
};

type EpisodeRequestOptions = {
  playerId?: string | null;
  resolve?: 'none' | 'first' | 'all';
};

const EPISODE_PLAYBACK_CACHE_TTL_MS = 120_000;
const episodePlaybackCache = new Map<string, { expiresAt: number; value: EpisodePlaybackResponse }>();
const episodePlaybackInFlight = new Map<string, Promise<EpisodePlaybackResponse>>();

const getEpisodePlaybackCacheKey = (id: string, options?: EpisodeRequestOptions) => {
  const normalizedId = String(id);
  if (options?.playerId) {
    return `${normalizedId}|player:${options.playerId}`;
  }
  return `${normalizedId}|resolve:${options?.resolve || 'first'}`;
};

const readEpisodePlaybackCache = (key: string): EpisodePlaybackResponse | null => {
  const entry = episodePlaybackCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    episodePlaybackCache.delete(key);
    return null;
  }
  return entry.value;
};

const writeEpisodePlaybackCache = (key: string, value: EpisodePlaybackResponse) => {
  episodePlaybackCache.set(key, {
    value,
    expiresAt: Date.now() + EPISODE_PLAYBACK_CACHE_TTL_MS,
  });
};

export const invalidateEpisodePlaybackCache = (episodeId: string) => {
  // Remove all cache entries for this episode so next load fetches fresh data
  for (const key of episodePlaybackCache.keys()) {
    if (key.startsWith(`${episodeId}|`)) {
      episodePlaybackCache.delete(key);
    }
  }
};

async function fetchAnimeDetails(slug: string, sourceSlug?: string, hints?: AnimeHints): Promise<AnimeDetails> {
  const parts: string[] = [];
  if (sourceSlug) parts.push(`sourceSlug=${encodePath(sourceSlug)}`);
  if (hints?.cover) parts.push(`hintCover=${encodePath(hints.cover)}`);
  if (hints?.name) parts.push(`hintName=${encodePath(hints.name)}`);
  if (hints?.rus) parts.push(`hintRus=${encodePath(hints.rus)}`);
  if (hints?.eng) parts.push(`hintEng=${encodePath(hints.eng)}`);
  const qs = parts.length ? `?${parts.join('&')}` : '';
  const payload = await request<RawResponse<RawAnimeSummary>>(`/anime/${encodePath(slug)}${qs}`);
  return mapAnimeDetails(payload.data);
}

async function fetchEpisodesByAnimeId(animeId: number | string): Promise<EpisodeListItem[]> {
  const payload = await request<RawResponse<RawEpisodeListItem[]>>(`/episodes?anime_id=${encodePath(String(animeId))}`);
  const items = Array.isArray(payload.data) ? payload.data : [];

  return items
    .map(mapEpisodeListItem)
    .sort((left, right) => {
      return episodeOrderValue(left) - episodeOrderValue(right);
    });
}

export const api = {
  baseUrl: API_BASE_URL,
  home: async (): Promise<HomeResponse> => {
    const [latestPayload, topViewsPayload] = await Promise.all([
      request<RawResponse<RawAnimeSummary[]>>('/latest-updates?page=1'),
      request<RawResponse<RawTopViewsPayload>>('/top-views?time=day'),
    ]);

    const items = Array.isArray(latestPayload.data) ? latestPayload.data.map(mapAnimeCard) : [];
    return {
      hero: buildHeroCards(topViewsPayload.data?.groups),
      highlight: items.slice(0, 5),
      latest: items,
    };
  },
  search: async (query: string, page = 1) => {
    const payload = await request<RawResponse<RawAnimeSummary[]>>(
      `/anime?q=${encodeURIComponent(query.trim())}&page=${page}`
    );

    return {
      results: Array.isArray(payload.data) ? payload.data.map(mapAnimeCard) : [],
      next: null,
    };
  },
  anime: fetchAnimeDetails,
  animePage: async (slug: string, sourceSlug?: string, hints?: AnimeHints): Promise<AnimePageResponse> => {
    const details = await fetchAnimeDetails(slug, sourceSlug, hints);
    const episodes = await fetchEpisodesByAnimeId(details.animeId);

    return {
      details,
      episodes,
    };
  },
  episodesByAnimeId: fetchEpisodesByAnimeId,
  episode: async (id: string, options?: EpisodeRequestOptions): Promise<EpisodePlaybackResponse> => {
    const cacheKey = getEpisodePlaybackCacheKey(id, options);
    const cached = readEpisodePlaybackCache(cacheKey);
    if (cached) {
      return cached;
    }

    const inFlight = episodePlaybackInFlight.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const resolveAllKey = getEpisodePlaybackCacheKey(id, { resolve: 'all' });
    const isPlayerResolvedInPayload = (
      payload: EpisodePlaybackResponse,
      playerId?: string | null
    ) => {
      if (!playerId) return false;
      const targetPlayer = payload.players.find((player) => player.id === playerId);
      if (!targetPlayer) return false;
      return Boolean(
        targetPlayer.srcResolved ||
          Object.keys(targetPlayer.qualityLinks || {}).length > 0 ||
          payload.resolvedPlayerIds.includes(targetPlayer.id)
      );
    };

    if (options?.playerId) {
      const resolvedAllCached = readEpisodePlaybackCache(resolveAllKey);
      if (resolvedAllCached && isPlayerResolvedInPayload(resolvedAllCached, options.playerId)) {
        return resolvedAllCached;
      }

      const resolvedAllInFlight = episodePlaybackInFlight.get(resolveAllKey);
      if (resolvedAllInFlight) {
        try {
          const resolvedAllPayload = await resolvedAllInFlight;
          if (isPlayerResolvedInPayload(resolvedAllPayload, options.playerId)) {
            return resolvedAllPayload;
          }
        } catch {
          // ignore resolve-all inflight errors and fallback to direct player resolve request
        }
      }
    } else if ((options?.resolve || 'first') !== 'all') {
      const resolvedAllCached = readEpisodePlaybackCache(resolveAllKey);
      if (resolvedAllCached) {
        return resolvedAllCached;
      }

      const resolvedAllInFlight = episodePlaybackInFlight.get(resolveAllKey);
      if (resolvedAllInFlight) {
        return resolvedAllInFlight;
      }
    }

    const nextRequest = (async () => {
      const params = new URLSearchParams();
      if (options?.playerId) {
        params.set('player_id', options.playerId);
      } else if (options?.resolve) {
        params.set('resolve', options.resolve);
      }

      const suffix = params.toString() ? `?${params.toString()}` : '';
      const payload = await request<RawResponse<RawEpisodeListItem & { players?: RawPlayer[] }>>(
        `/episodes/${encodePath(id)}${suffix}`
      );

      const item = payload.data;
      const players = Array.isArray(item.players) ? item.players.map(mapEpisodePlayer) : [];

      const result: EpisodePlaybackResponse = {
        id: String(item.id),
        animeId: Number(item.anime_id),
        title: String(item.name || '').trim(),
        episodeNumber: String(item.number || '?'),
        season: item.season != null ? String(item.season) : null,
        players,
        resolvedPlayerIds: Array.isArray(payload.meta?.resolved_player_ids)
          ? payload.meta.resolved_player_ids.map((value) => String(value))
          : [],
        resolveMode: String(payload.meta?.resolve_mode || options?.resolve || 'first'),
      };

      writeEpisodePlaybackCache(cacheKey, result);
      return result;
    })();

    episodePlaybackInFlight.set(cacheKey, nextRequest);
    try {
      return await nextRequest;
    } finally {
      if (episodePlaybackInFlight.get(cacheKey) === nextRequest) {
        episodePlaybackInFlight.delete(cacheKey);
      }
    }
  },
};
