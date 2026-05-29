import { Picker } from "@/lib/platform-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEventListener } from "expo";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import { Image as ExpoImage } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import { AppBottomSheet as BottomSheet } from "@/lib/bottom-sheet";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import NetInfo from "@react-native-community/netinfo";
import {
    ActionSheetIOS,
    ActivityIndicator,
    Alert,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";
import {
    SafeAreaView,
    useSafeAreaInsets,
} from "react-native-safe-area-context";

import { SectionHeader, StatusCard } from "@/components/ui";
import {
    AnimeDetails,
    AnimePageResponse,
    api,
    DiscoveringError,
    EpisodeListItem,
    EpisodePlaybackResponse,
    EpisodePlayer,
    getApiErrorMessage,
    getApiLabelText,
    getTitleText,
    invalidateEpisodePlaybackCache,
} from "@/lib/api";
import { addBookmark, isBookmarked, removeBookmark } from "@/lib/bookmarks";
import {
    buildDownloadId,
    DownloadItem,
    DownloadStatus,
    getDownloads,
    removeDownload,
    subscribeDownloads,
} from "@/lib/downloads";
import { getGenreName } from "@/lib/genres";
import { saveHistory } from "@/lib/history";
import { useI18n } from "@/lib/i18n";
import {
    getOfflineAnimeDetails,
    saveOfflineAnimeDetails,
} from "@/lib/offlineAnimeDetails";
import {
    enqueueEpisodeDownload,
    cancelDownload,
    removeOfflinePayload,
    resolveOfflinePlaylistUri,
} from "@/lib/offlineDownloads";
import { useTheme } from "@/lib/theme";
import { Ionicons } from "@expo/vector-icons";

const USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const PREFERRED_TEAM_SLUG_KEY = "preferred_team_slug_v1";
const PREFERRED_QUALITY_KEY = "preferred_quality_v1";
const HISTORY_DEBUG_LOGS = false;

const episodeSortValue = (episode: EpisodeListItem) => {
  if (episode.itemNumber != null) return episode.itemNumber;
  const numeric = Number(episode.episodeNumber);
  return Number.isFinite(numeric) ? numeric : 0;
};

const displayEpisodeTitle = (episode: EpisodeListItem, fallbackTitle: string) =>
  String(episode.title || "").trim() || fallbackTitle;

const displayEpisodeLabel = (episode: EpisodeListItem, fallbackTitle: string) =>
  `#${episode.episodeNumber} • ${displayEpisodeTitle(episode, fallbackTitle)}`;

const displayPlayerLabel = (
  player: EpisodePlayer,
  language: "en" | "ru",
  unknownTeam: string,
  unknownTranslation: string,
) => {
  const teamName = player.teamName || unknownTeam;
  const translationType =
    getApiLabelText(player.translationType, language) || unknownTranslation;
  return `${teamName} • ${translationType}`;
};

const sortQualities = (qualities: string[]) =>
  [...qualities].sort((left, right) => Number(right) - Number(left));

const pickPreferredQuality = (player: EpisodePlayer | null) => {
  if (!player) return null;
  const qualities = sortQualities(Object.keys(player.qualityLinks || {}));
  if (qualities.length > 0) {
    return qualities[0];
  }
  return player.qualityDefault || null;
};

const pickPreferredQualityWithFallback = (
  player: EpisodePlayer | null,
  preferredQuality?: string | null,
) => {
  if (!player) return null;
  const normalizedPreferred = String(preferredQuality || "").trim();
  if (normalizedPreferred && player.qualityLinks[normalizedPreferred]) {
    return normalizedPreferred;
  }
  return pickPreferredQuality(player);
};

const resolveStreamUrl = (
  player: EpisodePlayer | null,
  selectedQuality: string | null,
) => {
  if (!player) return null;
  if (selectedQuality && player.qualityLinks[selectedQuality]) {
    return player.qualityLinks[selectedQuality];
  }
  const fallbackQuality = pickPreferredQuality(player);
  if (fallbackQuality && player.qualityLinks[fallbackQuality]) {
    return player.qualityLinks[fallbackQuality];
  }
  return player.srcResolved || null;
};

const mergePlaybackPlayers = (
  current: EpisodePlaybackResponse | null,
  incoming: EpisodePlaybackResponse,
): EpisodePlaybackResponse => {
  if (!current || current.id !== incoming.id) {
    return incoming;
  }

  const byId = new Map(current.players.map((player) => [player.id, player]));
  for (const player of incoming.players) {
    const existing = byId.get(player.id);
    byId.set(player.id, existing ? { ...existing, ...player } : player);
  }

  return {
    ...incoming,
    players: Array.from(byId.values()),
    resolvedPlayerIds: Array.from(
      new Set([...current.resolvedPlayerIds, ...incoming.resolvedPlayerIds]),
    ),
  };
};

const metaValue = (value?: string | null) => value || "—";

const shouldUseCoverAsHeroBackground = (background?: string | null) => {
  const normalized = String(background || "").toLowerCase();
  if (!normalized) return true;
  if (normalized.includes("/static/images/placeholders/")) return true;
  // AnimeLib background files are usually short banners (e.g. 1900x400) and look pixelated when stretched.
  if (
    normalized.includes("/uploads/anime/") &&
    normalized.includes("/background/")
  )
    return true;
  return false;
};

const compactMetaValues = (details: AnimeDetails, language: "en" | "ru") =>
  [
    getApiLabelText(details.type, language),
    getApiLabelText(details.status, language),
    details.score ? `★ ${details.score}` : null,
  ].filter((value): value is string => Boolean(value));

const triggerSelectionHaptic = () => {
  void Haptics.selectionAsync().catch(() => {
    // no-op
  });
};

const triggerImpactHaptic = (style: Haptics.ImpactFeedbackStyle) => {
  void Haptics.impactAsync(style).catch(() => {
    // no-op
  });
};

const triggerNotificationHaptic = (type: Haptics.NotificationFeedbackType) => {
  void Haptics.notificationAsync(type).catch(() => {
    // no-op
  });
};

const toWholeNonNegativeSeconds = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
};

const toPercentLabel = (value: number) => {
  const normalized = Number.isFinite(value)
    ? Math.max(0, Math.min(value, 1))
    : 0;
  return `${Math.round(normalized * 100)}%`;
};

const downloadStatusPriority: Record<DownloadStatus, number> = {
  completed: 5,
  downloading: 4,
  queued: 3,
  paused: 2,
  failed: 1,
};

const historyDebugLog = (
  message: string,
  payload?: Record<string, unknown>,
) => {
  if (!HISTORY_DEBUG_LOGS) return;
  if (payload) {
    console.log(`[history] ${message}`, payload);
    return;
  }
  console.log(`[history] ${message}`);
};

const getCompletedOfflineItems = (items: DownloadItem[], animeId: string) =>
  items.filter(
    (item) =>
      item.animeId === animeId &&
      item.status === "completed" &&
      Boolean(String(item.localPlaylistUri || "").trim()),
  );

type OfflineEpisodeDownloadProgress = {
  episodeId: string;
  episodeTitle: string;
  episodeNumber: string | null;
  status: DownloadStatus;
  progress: number;
  updatedAt: number;
};

const buildOfflineEpisodes = (items: DownloadItem[]): EpisodeListItem[] => {
  const byEpisode = new Map<string, DownloadItem>();
  for (const item of items) {
    const existing = byEpisode.get(item.episodeId);
    if (
      !existing ||
      Number(item.updatedAt || 0) > Number(existing.updatedAt || 0)
    ) {
      byEpisode.set(item.episodeId, item);
    }
  }

  return Array.from(byEpisode.values())
    .map((item) => {
      const numericEpisode = Number(item.episodeNumber);
      const itemNumber = Number.isFinite(numericEpisode)
        ? numericEpisode
        : null;
      return {
        id: item.episodeId,
        animeId: Number(item.animeId) || 0,
        title: item.episodeTitle || "",
        episodeNumber: item.episodeNumber || "?",
        season: null,
        itemNumber,
        createdAt: null,
      } as EpisodeListItem;
    })
    .sort((left, right) => episodeSortValue(left) - episodeSortValue(right));
};

const buildOfflinePageData = (
  animeId: string,
  items: DownloadItem[],
): AnimePageResponse | null => {
  const allItems = items.filter((item) => item.animeId === animeId);
  if (!allItems.length) return null;

  const primary = allItems
    .slice()
    .sort(
      (left, right) =>
        Number(right.updatedAt || 0) - Number(left.updatedAt || 0),
    )[0];
  const fallbackTitle = String(primary.animeTitle || "").trim() || animeId;
  const title = primary.animeTitleByLanguage || {
    ru: fallbackTitle,
    en: fallbackTitle,
    jp: fallbackTitle,
  };

  return {
    details: {
      id: animeId,
      animeId: Number(primary.animeId) || 0,
      slug: animeId,
      title,
      cover: primary.cover || null,
      background: primary.cover || null,
      description: null,
      status: null,
      type: null,
      ageRating: null,
      releaseDate: null,
      score: null,
      shikimoriHref: null,
      anilistHref: null,
      restored: false,
      sourceManga: null,
      relatedAnime: [],
      genres: [],
    },
    episodes: buildOfflineEpisodes(allItems),
  };
};

const buildOfflinePlayback = (
  animeId: string,
  episodeId: string,
  items: DownloadItem[],
): EpisodePlaybackResponse | null => {
  const completed = getCompletedOfflineItems(items, animeId).filter(
    (item) => item.episodeId === episodeId,
  );
  if (!completed.length) return null;

  const selectedEpisode = completed
    .slice()
    .sort(
      (left, right) =>
        Number(right.updatedAt || 0) - Number(left.updatedAt || 0),
    )[0];

  const byTeam = new Map<
    string,
    {
      teamSlug: string | null;
      teamName: string;
      translationType: string;
      qualityLinks: Record<string, string>;
      firstUri: string | null;
    }
  >();

  for (const item of completed) {
    const localUri = String(item.localPlaylistUri || "").trim();
    if (!localUri) continue;

    const teamSlug = String(item.teamSlug || "").trim() || null;
    const teamKey = teamSlug || "__offline__";
    const teamName =
      String(item.teamName || "").trim() || teamSlug || "Offline";
    const translationType =
      String(item.translationType || "").trim() || "Offline";
    const qualityKey = String(item.quality || "").trim() || "default";

    const existing = byTeam.get(teamKey) || {
      teamSlug,
      teamName,
      translationType,
      qualityLinks: {},
      firstUri: null,
    };

    existing.qualityLinks[qualityKey] = localUri;
    if (!existing.firstUri) {
      existing.firstUri = localUri;
    }
    byTeam.set(teamKey, existing);
  }

  const players: EpisodePlayer[] = Array.from(byTeam.entries())
    .map(([teamKey, value]) => {
      const availableQualities = sortQualities(
        Object.keys(value.qualityLinks || {}),
      );
      const qualityDefault = availableQualities[0] || null;
      return {
        id: `offline:${episodeId}:${teamKey}`,
        player: "offline",
        translationType: value.translationType,
        teamName: value.teamName,
        teamSlug: value.teamSlug,
        views: null,
        src: null,
        srcResolved: qualityDefault
          ? value.qualityLinks[qualityDefault]
          : value.firstUri,
        qualityDefault,
        qualityLinks: value.qualityLinks,
      };
    })
    .filter((item) =>
      Boolean(
        item.srcResolved || Object.keys(item.qualityLinks || {}).length > 0,
      ),
    );

  if (!players.length) return null;

  return {
    id: episodeId,
    animeId: Number(selectedEpisode.animeId) || 0,
    title: selectedEpisode.episodeTitle || "",
    episodeNumber: selectedEpisode.episodeNumber || "?",
    season: null,
    players,
    resolvedPlayerIds: players.map((player) => player.id),
    resolveMode: "offline",
  };
};

export default function AnimeDetailsScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { t, language } = useI18n();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const params = useLocalSearchParams<{
    id?: string;
    episodeId?: string;
    sourceSlug?: string;
    hintCover?: string;
    hintName?: string;
    hintRus?: string;
    hintEng?: string;
    historyTeamSlug?: string;
    historyQuality?: string;
    historyPositionSec?: string;
    autoFullscreen?: string;
    startPlayerOnly?: string;
    scrollToPlayer?: string;
    offlineOnly?: string;
  }>();

  const slug = useMemo(() => String(params.id || "").trim(), [params.id]);
  const initialEpisodeId = useMemo(
    () => String(params.episodeId || "").trim(),
    [params.episodeId],
  );
  const sourceSlug = useMemo(
    () => String(params.sourceSlug || "").trim(),
    [params.sourceSlug],
  );
  const historyTeamSlug = useMemo(
    () => String(params.historyTeamSlug || "").trim() || null,
    [params.historyTeamSlug],
  );
  const historyQuality = useMemo(
    () => String(params.historyQuality || "").trim() || null,
    [params.historyQuality],
  );
  const historyPositionSec = useMemo(() => {
    const numeric = Number(params.historyPositionSec);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.floor(numeric));
  }, [params.historyPositionSec]);
  const shouldAutoFullscreen = useMemo(() => {
    const normalized = String(params.autoFullscreen || "")
      .trim()
      .toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes";
  }, [params.autoFullscreen]);
  const shouldStartPlayerOnly = useMemo(() => {
    const normalized = String(params.startPlayerOnly || "")
      .trim()
      .toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes";
  }, [params.startPlayerOnly]);
  const shouldScrollToPlayer = useMemo(() => {
    const normalized = String(params.scrollToPlayer || "")
      .trim()
      .toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes";
  }, [params.scrollToPlayer]);
  const isOfflineOnly = useMemo(() => {
    const normalized = String(params.offlineOnly || "")
      .trim()
      .toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes";
  }, [params.offlineOnly]);
  const hintParams = useMemo(
    () => ({
      cover: String(params.hintCover || "").trim() || undefined,
      name: String(params.hintName || "").trim() || undefined,
      rus: String(params.hintRus || "").trim() || undefined,
      eng: String(params.hintEng || "").trim() || undefined,
    }),
    [params.hintCover, params.hintName, params.hintRus, params.hintEng],
  );

  const [pageData, setPageData] = useState<AnimePageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [playerOnlyLaunchActive, setPlayerOnlyLaunchActive] = useState(
    shouldStartPlayerOnly,
  );
  const [retryCountdown, setRetryCountdown] = useState(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [playback, setPlayback] = useState<EpisodePlaybackResponse | null>(
    null,
  );
  const [playbackLoading, setPlaybackLoading] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(
    null,
  );
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [selectedQuality, setSelectedQuality] = useState<string | null>(null);
  const [downloadFlowLoading, setDownloadFlowLoading] = useState(false);
  const [downloadQueueing, setDownloadQueueing] = useState(false);
  const [downloadSheetEpisodeIds, setDownloadSheetEpisodeIds] = useState<
    string[]
  >([]);
  // Full episode list for download sheet — in offline mode pageData.episodes
  // only contains downloaded episodes, so we fetch all from API on sheet open
  const [downloadSheetAllEpisodes, setDownloadSheetAllEpisodes] = useState<
    import("@/lib/api").EpisodeListItem[]
  >([]);
  const [downloadSheetTeamSlug, setDownloadSheetTeamSlug] = useState<
    string | null
  >(null);
  const [downloadSheetQuality, setDownloadSheetQuality] = useState<
    string | null
  >(null);
  const [downloadSheetPlayers, setDownloadSheetPlayers] = useState<
    EpisodePlayer[]
  >([]);
  const [downloadSheetQualities, setDownloadSheetQualities] = useState<
    string[]
  >([]);
  const [downloadSheetMetaLoading, setDownloadSheetMetaLoading] =
    useState(false);
  const [downloadSheetPresented, setDownloadSheetPresented] = useState(false);
  const [downloadItems, setDownloadItems] = useState<DownloadItem[]>([]);
  const downloadItemsRef = useRef<DownloadItem[]>([]);

  // Android bottom sheet pickers for episode / player / quality
  const [episodeSheetPresented, setEpisodeSheetPresented] = useState(false);
  const [playerSheetPresented, setPlayerSheetPresented] = useState(false);
  const [qualitySheetPresented, setQualitySheetPresented] = useState(false);
  // Android bottom sheet pickers for download sheet voice / quality
  const [dlVoiceSheetPresented, setDlVoiceSheetPresented] = useState(false);
  const [dlQualitySheetPresented, setDlQualitySheetPresented] = useState(false);
  const [deleteSheetPresented, setDeleteSheetPresented] = useState(false);
  const [offlinePlaylistUri, setOfflinePlaylistUri] = useState<string | null>(
    null,
  );
  const [offlineFallbackToOnline, setOfflineFallbackToOnline] = useState(false);
  const [isResolvingOfflinePlaylist, setIsResolvingOfflinePlaylist] = useState(false);
  const [offlineLoadingTimeoutToken, setOfflineLoadingTimeoutToken] = useState<
    string | null
  >(null);
  const [preferredTeamReady, setPreferredTeamReady] = useState(false);
  const [nativeSubtitleCount, setNativeSubtitleCount] = useState(0);
  const playbackRef = useRef<EpisodePlaybackResponse | null>(null);
  const pendingSourceActionRef = useRef<{
    currentTime: number;
    shouldPlay: boolean;
  } | null>(null);
  const pendingSourceEpisodeIdRef = useRef<string | null>(null);
  const lastAppliedSourceKeyRef = useRef<string | null>(null);
  const activeSourceEpisodeIdRef = useRef<string | null>(null);
  const sourceSyncTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const lastHistoryProgressKeyRef = useRef<string | null>(null);
  const hasPlaybackStartedForHistoryRef = useRef(false);
  const historyWaitLoggedRef = useRef(false);
  const pendingHistoryTeamSlugRef = useRef<string | null>(historyTeamSlug);
  const pendingHistoryQualityRef = useRef<string | null>(historyQuality);
  const pendingHistoryPositionSecRef = useRef<number>(historyPositionSec);
  const pendingHistoryPositionEpisodeIdRef = useRef<string | null>(
    initialEpisodeId || null,
  );
  const pendingEpisodeAutoplayEpisodeIdRef = useRef<string | null>(null);
  const autoStartPlaybackRef = useRef(shouldAutoFullscreen);
  const autoFullscreenConsumedRef = useRef(false);
  const fullscreenEnteredRef = useRef(false);
  const fullscreenFallbackTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const offlineLoadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const offlineLoadingSourceKeyRef = useRef<string | null>(null);
  const detailsScrollRef = useRef<ScrollView | null>(null);
  const downloadSheetRequestIdRef = useRef(0);
  const videoViewRef = useRef<VideoView | null>(null);
  const hasAutoScrolledToPlayerRef = useRef(false);
  const [playerSectionY, setPlayerSectionY] = useState<number | null>(null);
  const languageRef = useRef(language);
  const tRef = useRef(t);
  const preferredTeamSlugRef = useRef<string | null>(null);
  const preferredQualityRef = useRef<string | null>(null);
  useEffect(() => {
    languageRef.current = language;
    tRef.current = t;
  });

  useEffect(() => {
    pendingHistoryTeamSlugRef.current = historyTeamSlug;
    pendingHistoryQualityRef.current = historyQuality;
    pendingHistoryPositionSecRef.current = historyPositionSec;
    pendingHistoryPositionEpisodeIdRef.current = initialEpisodeId || null;
    pendingEpisodeAutoplayEpisodeIdRef.current = null;
    autoStartPlaybackRef.current = shouldAutoFullscreen;
    autoFullscreenConsumedRef.current = false;
    fullscreenEnteredRef.current = false;
    if (fullscreenFallbackTimerRef.current) {
      clearTimeout(fullscreenFallbackTimerRef.current);
      fullscreenFallbackTimerRef.current = null;
    }
  }, [
    historyPositionSec,
    historyQuality,
    historyTeamSlug,
    initialEpisodeId,
    shouldAutoFullscreen,
  ]);

  useEffect(() => {
    setPlayerOnlyLaunchActive(shouldStartPlayerOnly);
  }, [shouldStartPlayerOnly]);

  useEffect(() => {
    hasAutoScrolledToPlayerRef.current = false;
    if (!shouldScrollToPlayer) return;
    setPlayerSectionY(null);
  }, [initialEpisodeId, shouldScrollToPlayer, slug]);

  // Track network connectivity
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsOnline(state.isConnected !== false && state.isInternetReachable !== false);
    });
    return unsubscribe;
  }, []);

  // Load bookmark state when the slug is known
  useEffect(() => {
    if (!slug) return;
    isBookmarked(slug)
      .then(setBookmarked)
      .catch(() => {});
  }, [slug]);

  const handleToggleBookmark = useCallback(() => {
    if (!slug || !pageData?.details) return;
    triggerSelectionHaptic();
    const { details } = pageData;
    const animeTitle =
      getTitleText(details.title, language) || t("anime.defaultTitle");
    if (bookmarked) {
      setBookmarked(false);
      void removeBookmark(slug).catch(() => setBookmarked(true));
    } else {
      setBookmarked(true);
      void addBookmark({
        animeId: slug,
        animeTitle,
        animeTitleByLanguage: details.title,
        cover: details.cover || null,
        shikimoriId: details.shikimoriHref ? String(details.shikimoriHref).split('/').pop() || null : null,
        anilistId: details.anilistHref ? String(details.anilistHref).split('/').pop() || null : null,
      }).catch(() => setBookmarked(false));
    }
  }, [bookmarked, language, pageData, slug, t]);

  // Keep headerShown in sync early (before handleOpenDownloadMenu is declared)
  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: !playerOnlyLaunchActive });
  }, [navigation, playerOnlyLaunchActive]);

  const clearFullscreenFallbackTimer = useCallback(() => {
    if (!fullscreenFallbackTimerRef.current) return;
    clearTimeout(fullscreenFallbackTimerRef.current);
    fullscreenFallbackTimerRef.current = null;
  }, []);

  const clearSourceSyncTimers = useCallback(() => {
    if (!sourceSyncTimersRef.current.length) return;
    sourceSyncTimersRef.current.forEach((timerId) => clearTimeout(timerId));
    sourceSyncTimersRef.current = [];
  }, []);

  const clearOfflineLoadingTimeout = useCallback(() => {
    if (!offlineLoadingTimeoutRef.current) return;
    clearTimeout(offlineLoadingTimeoutRef.current);
    offlineLoadingTimeoutRef.current = null;
    offlineLoadingSourceKeyRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      clearFullscreenFallbackTimer();
      clearSourceSyncTimers();
      clearOfflineLoadingTimeout();
    };
  }, [
    clearFullscreenFallbackTimer,
    clearOfflineLoadingTimeout,
    clearSourceSyncTimers,
  ]);

  const scrollToPlayerSection = useCallback((anchorY: number) => {
    const scrollView = detailsScrollRef.current;
    if (!scrollView) return;
    const targetY = Math.max(0, anchorY - 12);
    scrollView.scrollTo({ y: targetY, animated: true });
  }, []);

  useEffect(() => {
    if (!shouldScrollToPlayer || hasAutoScrolledToPlayerRef.current) return;
    if (!pageData || playerSectionY == null) return;

    hasAutoScrolledToPlayerRef.current = true;
    const timer = setTimeout(() => {
      scrollToPlayerSection(playerSectionY);
    }, 80);

    return () => {
      clearTimeout(timer);
    };
  }, [pageData, playerSectionY, scrollToPlayerSection, shouldScrollToPlayer]);

  const persistPreferredTeamSlug = useCallback((teamSlug?: string | null) => {
    const normalized = String(teamSlug || "").trim() || null;
    preferredTeamSlugRef.current = normalized;
    if (normalized) {
      AsyncStorage.setItem(PREFERRED_TEAM_SLUG_KEY, normalized).catch(() => {});
      return;
    }
    AsyncStorage.removeItem(PREFERRED_TEAM_SLUG_KEY).catch(() => {});
  }, []);

  const persistPreferredQuality = useCallback((quality?: string | null) => {
    const normalized = String(quality || "").trim() || null;
    preferredQualityRef.current = normalized;
    if (normalized) {
      AsyncStorage.setItem(PREFERRED_QUALITY_KEY, normalized).catch(() => {});
      return;
    }
    AsyncStorage.removeItem(PREFERRED_QUALITY_KEY).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      AsyncStorage.getItem(PREFERRED_TEAM_SLUG_KEY),
      AsyncStorage.getItem(PREFERRED_QUALITY_KEY),
    ])
      .then(([savedTeam, savedQuality]) => {
        if (cancelled) return;
        preferredTeamSlugRef.current = historyTeamSlug || String(savedTeam || "").trim() || null;
        preferredQualityRef.current = historyQuality || String(savedQuality || "").trim() || null;
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setPreferredTeamReady(true);
      });
    return () => { cancelled = true; };
  }, [historyTeamSlug, historyQuality]);

  const dlStatusSigRef = useRef<string>("");
  const dlLastFlushRef = useRef<number>(0);
  const dlPendingRef = useRef<DownloadItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getDownloads().then((items) => {
      if (!cancelled) {
        setDownloadItems(items);
      }
    });
    const unsubscribe = subscribeDownloads((next) => {
      if (cancelled) return;
      dlPendingRef.current = next;
      downloadItemsRef.current = next;
      const sig = next.map((i) => `${i.id}:${i.status}`).join("|");
      const now = Date.now();
      const statusChanged = sig !== dlStatusSigRef.current;
      if (statusChanged || now - dlLastFlushRef.current >= 1000) {
        dlStatusSigRef.current = sig;
        dlLastFlushRef.current = now;
        setDownloadItems(next);
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const selectedEpisode = useMemo(
    () =>
      pageData?.episodes.find((episode) => episode.id === selectedEpisodeId) ||
      null,
    [pageData?.episodes, selectedEpisodeId],
  );

  const currentEpisodeIndex = useMemo(
    () => pageData?.episodes.findIndex((e) => e.id === selectedEpisodeId) ?? -1,
    [pageData?.episodes, selectedEpisodeId],
  );

  const prevEpisode = useMemo(
    () =>
      currentEpisodeIndex > 0
        ? (pageData?.episodes[currentEpisodeIndex - 1] ?? null)
        : null,
    [currentEpisodeIndex, pageData?.episodes],
  );

  const nextEpisode = useMemo(
    () =>
      currentEpisodeIndex >= 0 &&
      currentEpisodeIndex < (pageData?.episodes.length ?? 0) - 1
        ? (pageData?.episodes[currentEpisodeIndex + 1] ?? null)
        : null,
    [currentEpisodeIndex, pageData?.episodes],
  );

  const selectedPlayer = useMemo(
    () =>
      playback?.players.find((player) => player.id === selectedPlayerId) ||
      null,
    [playback?.players, selectedPlayerId],
  );
  const selectedTeamSlug = selectedPlayer?.teamSlug || null;
  const effectiveQuality = useMemo(
    () => selectedQuality || pickPreferredQuality(selectedPlayer) || null,
    [selectedPlayer, selectedQuality],
  );
  const selectedDownloadId = useMemo(() => {
    if (!selectedEpisodeId) return null;
    return buildDownloadId(
      selectedEpisodeId,
      selectedTeamSlug,
      effectiveQuality,
    );
  }, [effectiveQuality, selectedEpisodeId, selectedTeamSlug]);
  const selectedDownload = useMemo(() => {
    if (!selectedDownloadId) return null;
    return downloadItems.find((item) => item.id === selectedDownloadId) || null;
  }, [downloadItems, selectedDownloadId]);

  const qualityOptions = useMemo(
    () => sortQualities(Object.keys(selectedPlayer?.qualityLinks || {})),
    [selectedPlayer?.qualityLinks],
  );
  const hasPlayerOptions = (playback?.players?.length ?? 0) > 0;
  const hasQualityOptions = qualityOptions.length > 1;

  const streamUrl = useMemo(
    () => resolveStreamUrl(selectedPlayer, effectiveQuality),
    [effectiveQuality, selectedPlayer],
  );
  const playbackUri =
    isOfflineOnly && !offlineFallbackToOnline
      ? offlinePlaylistUri || null
      : offlinePlaylistUri || streamUrl;
  const canDownloadCurrentEpisode = Boolean(
    pageData?.details && selectedEpisode && streamUrl,
  );
  const downloadButtonDisabled =
    !canDownloadCurrentEpisode || downloadFlowLoading || downloadQueueing;

  // Offline mode: episodes that need to be downloaded on THIS device
  // Only includes episodes that don't have a local file (failed/no localPlaylistUri)
  const offlineRedownloadableEpisodes = useMemo(() => {
    if (!isOfflineOnly || !slug) return [];
    return downloadItems.filter(
      (item) =>
        item.animeId === slug &&
        String(item.remoteStreamUrl || "").trim().length > 0 &&
        item.status !== "queued" &&
        item.status !== "downloading" &&
        item.status !== "completed" &&
        !String(item.localPlaylistUri || "").trim(),
    );
  }, [downloadItems, isOfflineOnly, slug]);

  // In offline mode button is active only if there are episodes missing locally
  const offlineDownloadableEpisodeCount = useMemo(() => {
    if (!isOfflineOnly || !slug) return 0;
    return downloadItems.filter(
      (item) =>
        item.animeId === slug &&
        item.status !== "queued" &&
        item.status !== "downloading" &&
        item.status !== "completed" &&
        !String(item.localPlaylistUri || "").trim(),
    ).length;
  }, [downloadItems, isOfflineOnly, slug]);

  const offlineDownloadButtonDisabled =
    !isOnline || downloadQueueing || (isOfflineOnly && offlineDownloadableEpisodeCount === 0);
  const downloadStatusText = useMemo(() => {
    if (!selectedDownload) return null;
    if (selectedDownload.status === "queued") return t("anime.downloadQueued");
    if (selectedDownload.status === "downloading") {
      return t("anime.downloadingEpisode", {
        percent: toPercentLabel(Number(selectedDownload.progress || 0)),
      });
    }
    if (selectedDownload.status === "completed")
      return t("anime.downloadedEpisode");
    if (selectedDownload.status === "failed") return t("anime.downloadFailed");
    return null;
  }, [selectedDownload, t]);
  const offlineEpisodeDownloadProgress = useMemo(() => {
    if (!isOfflineOnly || !slug) return [];

    const episodeById = new Map<string, EpisodeListItem>(
      (pageData?.episodes || []).map((episode) => [episode.id, episode]),
    );
    const byEpisode = new Map<string, OfflineEpisodeDownloadProgress>();
    const animeItems = downloadItems.filter((item) => item.animeId === slug);

    for (const item of animeItems) {
      const episodeId = String(item.episodeId || "").trim();
      if (!episodeId) continue;

      const rawProgress = Number(item.progress ?? 0);
      const normalizedProgress =
        item.status === "completed"
          ? 1
          : Number.isFinite(rawProgress)
            ? Math.max(0, Math.min(rawProgress, 1))
            : 0;

      const candidate: OfflineEpisodeDownloadProgress = {
        episodeId,
        episodeTitle: String(item.episodeTitle || "").trim(),
        episodeNumber:
          item.episodeNumber != null ? String(item.episodeNumber) : null,
        status: item.status,
        progress: normalizedProgress,
        updatedAt: Number(item.updatedAt || 0),
      };

      const existing = byEpisode.get(episodeId);
      if (!existing) {
        byEpisode.set(episodeId, candidate);
        continue;
      }

      const existingPriority = downloadStatusPriority[existing.status] || 0;
      const candidatePriority = downloadStatusPriority[candidate.status] || 0;
      const shouldReplace =
        candidatePriority > existingPriority ||
        (candidatePriority === existingPriority &&
          (candidate.progress > existing.progress ||
            (candidate.progress === existing.progress &&
              candidate.updatedAt >= existing.updatedAt)));

      if (shouldReplace) {
        byEpisode.set(episodeId, candidate);
      }
    }

    return Array.from(byEpisode.values()).sort((left, right) => {
      const leftEpisode = episodeById.get(left.episodeId);
      const rightEpisode = episodeById.get(right.episodeId);

      if (leftEpisode && rightEpisode) {
        return episodeSortValue(leftEpisode) - episodeSortValue(rightEpisode);
      }
      if (leftEpisode) return -1;
      if (rightEpisode) return 1;

      const leftNumeric = Number(left.episodeNumber);
      const rightNumeric = Number(right.episodeNumber);
      const leftHasNumeric = Number.isFinite(leftNumeric);
      const rightHasNumeric = Number.isFinite(rightNumeric);
      if (leftHasNumeric && rightHasNumeric) {
        return leftNumeric - rightNumeric;
      }
      if (leftHasNumeric) return -1;
      if (rightHasNumeric) return 1;

      return right.updatedAt - left.updatedAt;
    });
  }, [downloadItems, isOfflineOnly, pageData?.episodes, slug]);
  const offlineSelectedEpisodeProgress = useMemo(() => {
    if (!isOfflineOnly || !slug || !selectedEpisodeId) return null;

    const episodeItems = downloadItems.filter(
      (item) => item.animeId === slug && item.episodeId === selectedEpisodeId,
    );
    if (!episodeItems.length) return null;

    const preferredTeamSlug =
      String(selectedTeamSlug || historyTeamSlug || "").trim() || null;
    const preferredQuality =
      String(effectiveQuality || historyQuality || "").trim() || null;
    const exactId = buildDownloadId(
      selectedEpisodeId,
      preferredTeamSlug,
      preferredQuality,
    );
    const exact = episodeItems.find((item) => item.id === exactId) || null;

    const toOfflineProgress = (
      item: DownloadItem,
    ): OfflineEpisodeDownloadProgress => {
      const rawProgress = Number(item.progress ?? 0);
      const normalizedProgress =
        item.status === "completed"
          ? 1
          : Number.isFinite(rawProgress)
            ? Math.max(0, Math.min(rawProgress, 1))
            : 0;
      return {
        episodeId: String(item.episodeId || "").trim(),
        episodeTitle: String(item.episodeTitle || "").trim(),
        episodeNumber:
          item.episodeNumber != null ? String(item.episodeNumber) : null,
        status: item.status,
        progress: normalizedProgress,
        updatedAt: Number(item.updatedAt || 0),
      };
    };

    if (exact) {
      return toOfflineProgress(exact);
    }

    const isCandidateBetter = (
      next: readonly [number, number, number, number, number],
      current: readonly [number, number, number, number, number] | null,
    ) => {
      if (!current) return true;
      for (let index = 0; index < next.length; index += 1) {
        if (next[index] !== current[index]) {
          return next[index] > current[index];
        }
      }
      return false;
    };

    let bestItem: DownloadItem | null = null;
    let bestScore: readonly [number, number, number, number, number] | null =
      null;

    for (const item of episodeItems) {
      const itemTeamSlug = String(item.teamSlug || "").trim() || null;
      const itemQuality = String(item.quality || "").trim() || null;
      const rawProgress = Number(item.progress ?? 0);
      const normalizedProgress =
        item.status === "completed"
          ? 1
          : Number.isFinite(rawProgress)
            ? Math.max(0, Math.min(rawProgress, 1))
            : 0;

      const score: readonly [number, number, number, number, number] = [
        preferredTeamSlug ? (itemTeamSlug === preferredTeamSlug ? 1 : 0) : 0,
        preferredQuality ? (itemQuality === preferredQuality ? 1 : 0) : 0,
        downloadStatusPriority[item.status] || 0,
        normalizedProgress,
        Number(item.updatedAt || 0),
      ];

      if (isCandidateBetter(score, bestScore)) {
        bestItem = item;
        bestScore = score;
      }
    }

    if (bestItem) {
      return toOfflineProgress(bestItem);
    }

    return (
      offlineEpisodeDownloadProgress.find(
        (item) => item.episodeId === selectedEpisodeId,
      ) || null
    );
  }, [
    downloadItems,
    effectiveQuality,
    historyQuality,
    historyTeamSlug,
    isOfflineOnly,
    offlineEpisodeDownloadProgress,
    selectedEpisodeId,
    selectedTeamSlug,
    slug,
  ]);
  const downloadSheetSelectedSet = useMemo(
    () => new Set(downloadSheetEpisodeIds),
    [downloadSheetEpisodeIds],
  );
  const downloadSheetSelectedPlayer = useMemo(
    () =>
      downloadSheetPlayers.find(
        (playerOption) => playerOption.teamSlug === downloadSheetTeamSlug,
      ) || null,
    [downloadSheetPlayers, downloadSheetTeamSlug],
  );
  const downloadSheetVoiceLabel = useMemo(
    () =>
      downloadSheetSelectedPlayer
        ? displayPlayerLabel(
            downloadSheetSelectedPlayer,
            language,
            t("anime.unknownTeam"),
            t("anime.unknownTranslation"),
          )
        : t("anime.noPlayers"),
    [downloadSheetSelectedPlayer, language, t],
  );
  const downloadSheetQualityLabel = useMemo(
    () =>
      downloadSheetQuality
        ? `${downloadSheetQuality}p`
        : t("anime.noQualities"),
    [downloadSheetQuality, t],
  );
  const downloadSheetSelectedCountLabel = useMemo(
    () =>
      language === "ru"
        ? `Выбрано эпизодов: ${downloadSheetEpisodeIds.length}`
        : `Selected episodes: ${downloadSheetEpisodeIds.length}`,
    [downloadSheetEpisodeIds.length, language],
  );
  const downloadSheetCanQueue = useMemo(
    () =>
      downloadSheetEpisodeIds.length > 0 &&
      !downloadSheetMetaLoading &&
      isOnline &&
      (downloadSheetPlayers.length > 0 || Boolean(downloadSheetTeamSlug)),
    [
      downloadSheetEpisodeIds.length,
      downloadSheetMetaLoading,
      downloadSheetPlayers.length,
      downloadSheetTeamSlug,
      isOnline,
    ],
  );

  useEffect(() => {
    if (!selectedEpisodeId) {
      setOfflinePlaylistUri(null);
      setOfflineFallbackToOnline(false);
      setOfflineLoadingTimeoutToken(null);
      if (isOfflineOnly) {
        setPlaybackError(null);
      }
      return;
    }

    // Clear error immediately on episode change — prevents flash of old error
    setPlaybackError(null);
    setIsResolvingOfflinePlaylist(true);

    let cancelled = false;
    if (__DEV__) {
      console.log("[offline-player] resolve-start", {
        isOfflineOnly,
        episodeId: selectedEpisodeId,
        teamSlug: selectedTeamSlug,
        quality: effectiveQuality,
      });
    }
    void resolveOfflinePlaylistUri(
      selectedEpisodeId,
      selectedTeamSlug,
      effectiveQuality,
    )
      .then((result) => {
        if (!cancelled) {
          if (__DEV__) {
            console.log("[offline-player] resolve-result", {
              isOfflineOnly,
              episodeId: selectedEpisodeId,
              teamSlug: selectedTeamSlug,
              quality: effectiveQuality,
              result,
            });
          }
          setOfflinePlaylistUri(result.uri);
          setIsResolvingOfflinePlaylist(false);
          if (isOfflineOnly) {
            if (result.uri) {
              setOfflineFallbackToOnline(false);
              setOfflineLoadingTimeoutToken(null);
              setPlaybackError(null);
            } else {
              const message =
                language === "ru"
                  ? `Оффлайн-плейлист не найден (${result.reason}${result.lastInvalidReason ? `/${result.lastInvalidReason}` : ""})`
                  : `Offline playlist not found (${result.reason}${result.lastInvalidReason ? `/${result.lastInvalidReason}` : ""})`;
              setPlaybackError(message);
              if (__DEV__) {
                console.log("[offline-player] playlist-resolution-failed", {
                  episodeId: selectedEpisodeId,
                  teamSlug: selectedTeamSlug,
                  quality: effectiveQuality,
                  result,
                });
              }
            }
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOfflinePlaylistUri(null);
          setIsResolvingOfflinePlaylist(false);
          if (isOfflineOnly) {
            setPlaybackError(
              language === "ru"
                ? "Не удалось проверить оффлайн-плейлист"
                : "Failed to validate offline playlist",
            );
          }
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    effectiveQuality,
    isOfflineOnly,
    language,
    selectedDownload?.localPlaylistUri,
    selectedEpisodeId,
    selectedTeamSlug,
  ]);

  const videoSource = useMemo(() => {
    if (!playbackUri) return null;

    if (offlinePlaylistUri && playbackUri === offlinePlaylistUri) {
      // Local video files (.ts, .mp4) — NO contentType, let AVPlayer auto-detect.
      // iOS AVPlayer cannot play local m3u8 via file://, so we download segments
      // as a concatenated .ts file and play it directly.
      const isDirectVideoFile =
        playbackUri.toLowerCase().endsWith(".ts") ||
        playbackUri.toLowerCase().endsWith(".mp4");
      if (isDirectVideoFile) {
        return { uri: playbackUri } as const;
      }
      return {
        uri: playbackUri,
        contentType: "hls",
      } as const;
    }

    return {
      uri: playbackUri,
      headers: {
        Accept: "*/*",
        "User-Agent": USER_AGENT,
      },
      contentType: "hls",
    } as const;
  }, [offlinePlaylistUri, playbackUri]);

  const player = useVideoPlayer(null, (instance) => {
    instance.loop = false;
  });

  useEventListener(player, "statusChange", ({ status, error: playerError }) => {
    if (__DEV__) {
      console.log("[offline-player] statusChange", {
        status,
        episodeId: selectedEpisodeId,
        playerId: selectedPlayerId,
        quality: selectedQuality,
        uri: playbackUri,
        message: playerError?.message || null,
      });
    }
    if (status !== "loading") {
      clearOfflineLoadingTimeout();
    }
    if (
      status === "loading" &&
      isOfflineOnly &&
      playbackUri?.startsWith("file://")
    ) {
      const loadingSourceKey = `${selectedEpisodeId || ""}|${selectedPlayerId || ""}|${selectedQuality || ""}|${playbackUri}`;
      if (
        offlineLoadingSourceKeyRef.current === loadingSourceKey &&
        offlineLoadingTimeoutRef.current
      ) {
        return;
      }
      clearOfflineLoadingTimeout();
      offlineLoadingSourceKeyRef.current = loadingSourceKey;
      const uriAtStart = playbackUri;
      const episodeIdAtStart = selectedEpisodeId;
      offlineLoadingTimeoutRef.current = setTimeout(() => {
        if (!isOfflineOnly) return;
        if (!playbackUri || playbackUri !== uriAtStart) return;
        setOfflineLoadingTimeoutToken(loadingSourceKey);
        const stuckMessage =
          language === "ru"
            ? "Оффлайн-видео на iOS зависло на загрузке (HLS file://)."
            : "Offline video on iOS is stuck loading (HLS file://).";
        setPlaybackError(stuckMessage);
        if (__DEV__) {
          console.log("[offline-player] loading-timeout", {
            episodeId: episodeIdAtStart,
            playerId: selectedPlayerId,
            quality: selectedQuality,
            uri: uriAtStart,
          });
        }
      }, 12000);
    }
    if (status !== "error") return;
    if (__DEV__) {
      console.log("[offline-player] statusChange:error", {
        episodeId: selectedEpisodeId,
        playerId: selectedPlayerId,
        quality: selectedQuality,
        uri: playbackUri,
        message: playerError?.message || null,
      });
    }
    triggerNotificationHaptic(Haptics.NotificationFeedbackType.Error);
    setPlaybackError(playerError?.message || t("anime.playbackUnavailable"));
  });

  useEventListener(player, "sourceLoad", ({ availableSubtitleTracks }) => {
    clearOfflineLoadingTimeout();
    if (__DEV__) {
      const dur = Number(player.duration);
      console.log("[offline-player] sourceLoad", {
        episodeId: selectedEpisodeId,
        playerId: selectedPlayerId,
        quality: selectedQuality,
        uri: playbackUri,
        isOfflineUri: playbackUri?.startsWith("file://"),
        duration: dur,
        durationValid: Number.isFinite(dur) && dur > 0,
        status: player.status,
      });
    }
    setPlaybackError(null);
    const tracks = Array.isArray(availableSubtitleTracks)
      ? availableSubtitleTracks
      : [];
    setNativeSubtitleCount(tracks.length);
    if (tracks.length && !player.subtitleTrack) {
      const preferred =
        tracks.find((track) =>
          Boolean((track as { isDefault?: boolean }).isDefault),
        ) || tracks[0];
      player.subtitleTrack = preferred || null;
    }

    const pendingAction = pendingSourceActionRef.current;
    if (!pendingAction) return;

    const pendingEpisodeId = pendingSourceEpisodeIdRef.current;
    if (pendingEpisodeId) {
      activeSourceEpisodeIdRef.current = pendingEpisodeId;
    }
    const sourceEpisodeId =
      pendingEpisodeId || activeSourceEpisodeIdRef.current;
    pendingSourceEpisodeIdRef.current = null;
    pendingSourceActionRef.current = null;
    const targetTime = Math.max(0, pendingAction.currentTime);
    player.currentTime = targetTime;
    if (pendingAction.shouldPlay) {
      player.play();
    } else {
      player.pause();
    }

    clearSourceSyncTimers();
    if (sourceEpisodeId && targetTime > 0) {
      [260, 900].forEach((delayMs) => {
        const timerId = setTimeout(() => {
          if (activeSourceEpisodeIdRef.current !== sourceEpisodeId) return;
          try {
            const current = Number(player.currentTime);
            if (!Number.isFinite(current)) return;
            if (Math.abs(current - targetTime) > 1.25) {
              player.currentTime = targetTime;
            }
          } catch {
            // ignore sync correction errors
          }
        }, delayMs);
        sourceSyncTimersRef.current.push(timerId);
      });
    }
  });

  const applyPlayerSelection = useCallback(
    (
      nextPlayback: EpisodePlaybackResponse,
      preferredPlayerId?: string | null,
    ) => {
      const isResolved = (p: EpisodePlayer) =>
        Boolean(
          p.srcResolved ||
          Object.keys(p.qualityLinks || {}).length > 0 ||
          nextPlayback.resolvedPlayerIds.includes(p.id),
        );

      let nextPlayerId = preferredPlayerId || null;
      const preferredTeamSlug =
        pendingHistoryTeamSlugRef.current || preferredTeamSlugRef.current;

      if (!nextPlayerId && preferredTeamSlug) {
        // First try resolved match, then any match — don't fall back to wrong team
        const teamMatch =
          nextPlayback.players.find(
            (p) => p.teamSlug === preferredTeamSlug && isResolved(p),
          ) ||
          nextPlayback.players.find(
            (p) => p.teamSlug === preferredTeamSlug,
          );
        nextPlayerId = teamMatch?.id || null;
      }

      if (!nextPlayerId) {
        nextPlayerId =
          nextPlayback.resolvedPlayerIds[0] ||
          nextPlayback.players.find(isResolved)?.id ||
          nextPlayback.players[0]?.id ||
          null;
      }

      const nextPlayer =
        nextPlayback.players.find((item) => item.id === nextPlayerId) ||
        nextPlayback.players[0] ||
        null;

      // Only persist preferred team if it matches what user actually chose
      // Don't overwrite with a fallback player
      const isPreferredTeamMatch =
        nextPlayer?.teamSlug === preferredTeamSlug;
      const shouldPersistPreferredTeam =
        Boolean(nextPlayer?.teamSlug) &&
        (Boolean(preferredPlayerId) || isPreferredTeamMatch);
      if (shouldPersistPreferredTeam && nextPlayer?.teamSlug) {
        persistPreferredTeamSlug(nextPlayer.teamSlug);
      }

      setSelectedPlayerId(nextPlayer?.id || null);
      setSelectedQuality(
        pickPreferredQualityWithFallback(
          nextPlayer,
          pendingHistoryQualityRef.current || preferredQualityRef.current,
        ),
      );

      if (
        nextPlayer?.teamSlug &&
        pendingHistoryTeamSlugRef.current === nextPlayer.teamSlug
      ) {
        pendingHistoryTeamSlugRef.current = null;
      }
      if (pendingHistoryQualityRef.current) {
        const qualityFromHistory = pendingHistoryQualityRef.current;
        if (nextPlayer?.qualityLinks[qualityFromHistory]) {
          pendingHistoryQualityRef.current = null;
        }
      }
    },
    [persistPreferredTeamSlug],
  );

  const loadPlayback = useCallback(
    async (
      episodeId: string,
      preferredPlayerId?: string | null,
      options?: { forceOnline?: boolean },
    ) => {
      try {
        setPlaybackLoading(true);
        setPlaybackError(null);
        if (isOfflineOnly && !options?.forceOnline) {
          let offlinePlayback = buildOfflinePlayback(
            slug,
            episodeId,
            downloadItemsRef.current,
          );
          if (!offlinePlayback) {
            const snapshot = await getDownloads();
            offlinePlayback = buildOfflinePlayback(slug, episodeId, snapshot);
          }
          if (!offlinePlayback) {
            setPlayback(null);
            setPlaybackError(tRef.current("anime.playbackUnavailable"));
            return;
          }
          const mergedOfflinePlayback = mergePlaybackPlayers(
            playbackRef.current,
            offlinePlayback,
          );
          playbackRef.current = mergedOfflinePlayback;
          setPlayback(mergedOfflinePlayback);
          applyPlayerSelection(mergedOfflinePlayback, preferredPlayerId);
          return;
        }

        const preferredTeamSlug =
          pendingHistoryTeamSlugRef.current || preferredTeamSlugRef.current;
        const requestOptions = preferredPlayerId
          ? { playerId: preferredPlayerId }
          : undefined;
        const payload = await api.episode(episodeId, requestOptions);
        const mergedPlayback = mergePlaybackPlayers(
          playbackRef.current,
          payload,
        );
        playbackRef.current = mergedPlayback;
        setPlayback(mergedPlayback);
        if (mergedPlayback.players.length === 0) {
          return;
        }
        applyPlayerSelection(mergedPlayback, preferredPlayerId);

        if (!preferredPlayerId && preferredTeamSlug) {
          const preferredUnresolved = mergedPlayback.players.find(
            (p) =>
              p.teamSlug === preferredTeamSlug &&
              !p.srcResolved &&
              Object.keys(p.qualityLinks || {}).length === 0 &&
              !mergedPlayback.resolvedPlayerIds.includes(p.id) &&
              Boolean(p.src),
          );
          if (preferredUnresolved) {
            void api
              .episode(episodeId, { playerId: preferredUnresolved.id })
              .then((bgPayload) => {
                if (playbackRef.current?.id !== episodeId) return;
                const bgMerged = mergePlaybackPlayers(
                  playbackRef.current,
                  bgPayload,
                );
                playbackRef.current = bgMerged;
                setPlayback(bgMerged);
                applyPlayerSelection(bgMerged, preferredUnresolved.id);
              })
              .catch(() => {});
          }
        }
      } catch (err) {
        setPlaybackError(
          getApiErrorMessage(
            err,
            languageRef.current,
            tRef.current("anime.playbackUnavailable"),
          ),
        );
      } finally {
        setPlaybackLoading(false);
      }
    },
    [applyPlayerSelection, isOfflineOnly, slug],
  );

  useEffect(() => {
    if (isOfflineOnly) return;
    if (!selectedEpisodeId) return;
    const warmupEpisodeId = nextEpisode?.id || prevEpisode?.id;
    if (!warmupEpisodeId || warmupEpisodeId === selectedEpisodeId) return;

    void api.episode(warmupEpisodeId).catch(() => {
      // ignore warmup errors
    });
  }, [isOfflineOnly, nextEpisode?.id, prevEpisode?.id, selectedEpisodeId]);

  const scheduleRetry = useCallback((seconds: number) => {
    setRetryCountdown(seconds);
    const tick = () => {
      setRetryCountdown((prev) => {
        if (prev <= 1) return 0;
        retryTimerRef.current = setTimeout(tick, 1000);
        return prev - 1;
      });
    };
    retryTimerRef.current = setTimeout(tick, 1000);
  }, []);

  const loadPage = useCallback(async () => {
    if (!slug) return;

    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    try {
      setLoading(true);
      setError(null);
      setDiscovering(false);

      if (isOfflineOnly) {
        const snapshot = await getDownloads();
        const offlinePage = buildOfflinePageData(slug, snapshot);
        if (!offlinePage) {
          setPageData(null);
          setError(t("downloads.emptyBody"));
          return;
        }

        const savedDetails = await getOfflineAnimeDetails(slug);
        setPageData(
          savedDetails
            ? {
                ...offlinePage,
                details: { ...offlinePage.details, ...savedDetails },
              }
            : offlinePage,
        );

        void api
          .animePage(slug, sourceSlug || undefined, hintParams)
          .then((payload) => {
            void saveOfflineAnimeDetails(slug, payload.details);
            const offlineEpisodeIds = new Set(
              offlinePage.episodes.map((episode) => episode.id),
            );
            const episodes = payload.episodes
              .filter((episode) => offlineEpisodeIds.has(episode.id))
              .sort(
                (left, right) =>
                  episodeSortValue(left) - episodeSortValue(right),
              );
            if (episodes.length > 0) {
              setPageData({ ...payload, episodes });
            }
          })
          .catch(() => {});

        return;
      }

      const payload = await api.animePage(
        slug,
        sourceSlug || undefined,
        hintParams,
      );
      const episodes = [...payload.episodes].sort(
        (left, right) => episodeSortValue(left) - episodeSortValue(right),
      );
      const nextPage = { ...payload, episodes };
      setPageData(nextPage);
      void saveOfflineAnimeDetails(slug, payload.details);
    } catch (err) {
      if (err instanceof DiscoveringError) {
        setDiscovering(true);
        scheduleRetry(25);
      } else {
        const errorMessage = getApiErrorMessage(
          err,
          language,
          t("anime.error"),
        );
        try {
          const snapshot = await getDownloads();
          const offlineFallback = buildOfflinePageData(slug, snapshot);
          if (offlineFallback) {
            const savedDetails = await getOfflineAnimeDetails(slug);
            setPageData(
              savedDetails
                ? {
                    ...offlineFallback,
                    details: { ...offlineFallback.details, ...savedDetails },
                  }
                : offlineFallback,
            );
            return;
          }
        } catch {
          // ignore fallback errors
        }
        setError(errorMessage);
      }
    } finally {
      setLoading(false);
    }
  }, [hintParams, isOfflineOnly, language, scheduleRetry, slug, sourceSlug, t]);

  useEffect(() => {
    loadPage();
  }, [loadPage]);

  useEffect(() => {
    if (isOfflineOnly) return;
    if (retryCountdown === 0 && discovering) {
      loadPage();
    }
  }, [discovering, isOfflineOnly, retryCountdown, loadPage]);

  useEffect(() => {
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!pageData?.episodes?.length) return;

    if (
      selectedEpisodeId &&
      pageData.episodes.some((episode) => episode.id === selectedEpisodeId)
    )
      return;

    const hasInitialEpisode =
      initialEpisodeId &&
      pageData.episodes.some((episode) => episode.id === initialEpisodeId);
    const nextEpisodeId = hasInitialEpisode
      ? initialEpisodeId
      : pageData.episodes[0]?.id || null;

    if (nextEpisodeId && nextEpisodeId !== selectedEpisodeId) {
      setSelectedEpisodeId(nextEpisodeId);
    }
  }, [initialEpisodeId, pageData?.episodes, selectedEpisodeId]);

  useEffect(() => {
    if (!selectedEpisodeId || !preferredTeamReady) return;
    clearSourceSyncTimers();
    activeSourceEpisodeIdRef.current = null;
    pendingSourceEpisodeIdRef.current = null;
    try {
      player.pause();
      player.currentTime = 0;
    } catch {
      // ignore transition reset errors
    }
    playbackRef.current = null;
    setPlayback(null);
    // Don't reset selectedPlayerId to null — keep showing current team name
    // until new playback loads. applyPlayerSelection will update it correctly.
    setSelectedQuality(null);
    setNativeSubtitleCount(0);
    loadPlayback(selectedEpisodeId);
  }, [
    clearSourceSyncTimers,
    loadPlayback,
    player,
    preferredTeamReady,
    selectedEpisodeId,
  ]);

  useEffect(() => {
    if (!offlineLoadingTimeoutToken) return;
    if (!isOfflineOnly || !selectedEpisodeId) return;
    if (offlineFallbackToOnline) return;

    if (__DEV__) {
      console.log("[offline-player] fallback-to-online", {
        episodeId: selectedEpisodeId,
        token: offlineLoadingTimeoutToken,
      });
    }
    setOfflineFallbackToOnline(true);
    setOfflinePlaylistUri(null);
    setOfflineLoadingTimeoutToken(null);
    setPlaybackError(
      language === "ru"
        ? "Локальный оффлайн HLS завис на iOS, пробую онлайн-поток."
        : "Local offline HLS is stuck on iOS, trying online stream.",
    );
    void loadPlayback(selectedEpisodeId, undefined, { forceOnline: true });
  }, [
    isOfflineOnly,
    language,
    loadPlayback,
    offlineFallbackToOnline,
    offlineLoadingTimeoutToken,
    selectedEpisodeId,
  ]);

  // Clear player when there's no URI to play — prevents old frame from showing
  useEffect(() => {
    if (!playbackUri && !playbackLoading) {
      try { player.replace(null); } catch { /* ignore */ }
    }
  }, [playbackUri, playbackLoading, player]);

  useEffect(() => {
    if (!playback?.id || playback.id !== selectedEpisodeId) return;
    if (!videoSource || !playbackUri) {
      // No source available — clear the player so old frame doesn't show
      try { player.replace(null); } catch { /* ignore */ }
      return;
    }
    const sourceKey = `${selectedEpisodeId || ""}|${selectedPlayerId || ""}|${selectedQuality || ""}|${playbackUri}`;
    if (lastAppliedSourceKeyRef.current === sourceKey) return;

    const isSameEpisode =
      Boolean(selectedEpisodeId) &&
      activeSourceEpisodeIdRef.current === selectedEpisodeId;
    let currentTime = 0;
    let shouldPlay = false;
    if (isSameEpisode) {
      try {
        const rawCurrentTime = player.currentTime;
        currentTime = Number.isFinite(rawCurrentTime)
          ? Math.max(rawCurrentTime, 0)
          : 0;
      } catch {
        currentTime = 0;
      }
      try {
        shouldPlay = Boolean(player.playing);
      } catch {
        shouldPlay = false;
      }
    } else {
      const resumeEpisodeId = pendingHistoryPositionEpisodeIdRef.current;
      const resumePositionSec = pendingHistoryPositionSecRef.current;
      const shouldAutoplayEpisodeSwitch =
        Boolean(selectedEpisodeId) &&
        pendingEpisodeAutoplayEpisodeIdRef.current === selectedEpisodeId;
      const shouldAutoStartNow =
        autoStartPlaybackRef.current &&
        Boolean(selectedEpisodeId) &&
        selectedEpisodeId ===
          (resumeEpisodeId || initialEpisodeId || selectedEpisodeId);
      if (shouldAutoplayEpisodeSwitch) {
        shouldPlay = true;
        pendingEpisodeAutoplayEpisodeIdRef.current = null;
      }
      if (
        resumeEpisodeId &&
        selectedEpisodeId === resumeEpisodeId &&
        resumePositionSec > 0
      ) {
        currentTime = resumePositionSec;
        pendingHistoryPositionEpisodeIdRef.current = null;
        pendingHistoryPositionSecRef.current = 0;
        if (shouldAutoStartNow) {
          shouldPlay = true;
          autoStartPlaybackRef.current = false;
          historyDebugLog("auto start playback from history resume", {
            animeId: pageData?.details?.slug || slug,
            episodeId: selectedEpisodeId,
            positionSec: currentTime,
          });
        }
        historyDebugLog("resume playback position from history", {
          animeId: pageData?.details?.slug || slug,
          episodeId: selectedEpisodeId,
          positionSec: currentTime,
        });
      } else if (shouldAutoStartNow) {
        shouldPlay = true;
        autoStartPlaybackRef.current = false;
        historyDebugLog("auto start playback for fullscreen open", {
          animeId: pageData?.details?.slug || slug,
          episodeId: selectedEpisodeId || "",
        });
      }
    }

    pendingSourceActionRef.current = { currentTime, shouldPlay };
    pendingSourceEpisodeIdRef.current = selectedEpisodeId || null;
    lastAppliedSourceKeyRef.current = sourceKey;

    let cancelled = false;
    void player.replaceAsync(videoSource).catch((error) => {
      if (cancelled) return;
      try {
        player.replace(videoSource, true);
      } catch {
        pendingSourceEpisodeIdRef.current = null;
        pendingSourceActionRef.current = null;
        setPlaybackError(
          error instanceof Error
            ? error.message
            : t("anime.playbackUnavailable"),
        );
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    initialEpisodeId,
    pageData?.details?.slug,
    playback?.id,
    playbackUri,
    player,
    selectedEpisodeId,
    selectedPlayerId,
    selectedQuality,
    slug,
    t,
    videoSource,
  ]);

  const persistEpisodeWatchProgress = useCallback(() => {
    if (!pageData?.details || !selectedEpisode) return;
    if (
      !activeSourceEpisodeIdRef.current ||
      activeSourceEpisodeIdRef.current !== selectedEpisode.id
    )
      return;

    let isPlaying = false;
    try {
      isPlaying = Boolean(player.playing);
    } catch {
      return;
    }

    if (!hasPlaybackStartedForHistoryRef.current) {
      if (!isPlaying) {
        if (!historyWaitLoggedRef.current) {
          historyWaitLoggedRef.current = true;
          historyDebugLog("waiting for user to start playback", {
            animeId: pageData.details.slug,
            episodeId: selectedEpisode.id,
          });
        }
        return;
      }
      hasPlaybackStartedForHistoryRef.current = true;
      historyWaitLoggedRef.current = false;
      historyDebugLog("playback started, history tracking enabled", {
        animeId: pageData.details.slug,
        episodeId: selectedEpisode.id,
      });
    }

    let positionSec = 0;
    let durationSec = 0;
    try {
      positionSec = toWholeNonNegativeSeconds(player.currentTime);
      durationSec = toWholeNonNegativeSeconds(player.duration);
    } catch {
      return;
    }
    const progress =
      durationSec > 0 ? Math.max(0, Math.min(positionSec / durationSec, 1)) : 0;
    const progressKey = `${selectedEpisode.id}|${positionSec}|${durationSec}`;
    if (progressKey === lastHistoryProgressKeyRef.current) return;

    lastHistoryProgressKeyRef.current = progressKey;
    saveHistory({
      animeId: pageData.details.slug,
      animeTitle:
        getTitleText(pageData.details.title, language) ||
        t("anime.defaultTitle"),
      animeTitleByLanguage: pageData.details.title,
      cover: pageData.details.cover || null,
      shikimoriId: pageData.details.shikimoriHref ? String(pageData.details.shikimoriHref).split('/').pop() || null : null,
      anilistId: pageData.details.anilistHref ? String(pageData.details.anilistHref).split('/').pop() || null : null,
      episodeId: selectedEpisode.id,
      episodeTitle: selectedEpisode.title,
      episodeNumber: selectedEpisode.episodeNumber,
      teamSlug: selectedPlayer?.teamSlug || null,
      quality: selectedQuality || pickPreferredQuality(selectedPlayer) || null,
      positionSec,
      durationSec,
      progress,
    })
      .then(() => {
        historyDebugLog("history saved", {
          animeId: pageData.details.slug,
          episodeId: selectedEpisode.id,
          positionSec,
          durationSec,
          teamSlug: selectedPlayer?.teamSlug || null,
          quality:
            selectedQuality || pickPreferredQuality(selectedPlayer) || null,
          progress: Number(progress.toFixed(3)),
        });
      })
      .catch(() => {
        // ignore local history write errors
      });
  }, [
    language,
    pageData?.details,
    player,
    selectedEpisode,
    selectedPlayer,
    selectedQuality,
    t,
  ]);

  useEventListener(player, "playingChange", ({ isPlaying }) => {
    if (!isPlaying) return;
    persistEpisodeWatchProgress();
  });

  const requestAutoFullscreen = useCallback(
    (origin: "initial" | "first-frame") => {
      if (
        !shouldAutoFullscreen ||
        !playerOnlyLaunchActive ||
        fullscreenEnteredRef.current
      )
        return;
      const videoView = videoViewRef.current;
      if (!videoView) return;

      autoFullscreenConsumedRef.current = true;
      void videoView
        .enterFullscreen()
        .then(() => {
          historyDebugLog("auto fullscreen requested", {
            animeId: pageData?.details?.slug || slug,
            episodeId: selectedEpisodeId || "",
            origin,
          });
        })
        .catch((error) => {
          autoFullscreenConsumedRef.current = false;
          historyDebugLog("auto fullscreen request failed", {
            animeId: pageData?.details?.slug || slug,
            episodeId: selectedEpisodeId || "",
            origin,
            error: error instanceof Error ? error.message : String(error),
          });
          if (playerOnlyLaunchActive) {
            setPlayerOnlyLaunchActive(false);
          }
        });
    },
    [
      pageData?.details?.slug,
      playerOnlyLaunchActive,
      selectedEpisodeId,
      shouldAutoFullscreen,
      slug,
    ],
  );

  useEffect(() => {
    if (
      !shouldAutoFullscreen ||
      !playerOnlyLaunchActive ||
      !playbackUri ||
      fullscreenEnteredRef.current
    ) {
      clearFullscreenFallbackTimer();
      return;
    }

    if (!autoFullscreenConsumedRef.current) {
      requestAutoFullscreen("initial");
    }

    clearFullscreenFallbackTimer();
    fullscreenFallbackTimerRef.current = setTimeout(() => {
      fullscreenFallbackTimerRef.current = null;
      if (fullscreenEnteredRef.current || !playerOnlyLaunchActive) return;

      autoFullscreenConsumedRef.current = false;
      historyDebugLog("auto fullscreen timeout fallback", {
        animeId: pageData?.details?.slug || slug,
        episodeId: selectedEpisodeId || "",
      });
      setPlayerOnlyLaunchActive(false);
    }, 3500);

    return () => {
      clearFullscreenFallbackTimer();
    };
  }, [
    clearFullscreenFallbackTimer,
    pageData?.details?.slug,
    playerOnlyLaunchActive,
    requestAutoFullscreen,
    selectedEpisodeId,
    shouldAutoFullscreen,
    slug,
    playbackUri,
  ]);

  useEffect(() => {
    if (!pageData?.details || !selectedEpisode || !playbackUri) return;
    lastHistoryProgressKeyRef.current = null;
    hasPlaybackStartedForHistoryRef.current = false;
    historyWaitLoggedRef.current = false;
    historyDebugLog("history tracker armed for episode", {
      animeId: pageData.details.slug,
      episodeId: selectedEpisode.id,
    });

    const intervalId = setInterval(() => {
      persistEpisodeWatchProgress();
    }, 1000);

    return () => {
      clearInterval(intervalId);
    };
  }, [
    pageData?.details,
    persistEpisodeWatchProgress,
    playbackUri,
    selectedEpisode,
  ]);

  const handleSelectEpisode = useCallback((episode: EpisodeListItem) => {
    triggerSelectionHaptic();
    setPlaybackError(null);
    lastAppliedSourceKeyRef.current = null;
    pendingEpisodeAutoplayEpisodeIdRef.current = episode.id;
    setSelectedEpisodeId(episode.id);
  }, []);

  const openEpisodeSelector = useCallback(() => {
    if (Platform.OS !== "ios") {
      setEpisodeSheetPresented(true);
      return;
    }

    const episodes = pageData?.episodes || [];
    if (!episodes.length) return;

    const cancelLabel = language === "ru" ? "Отмена" : "Cancel";
    const options = episodes.map((episode) => {
      const label = displayEpisodeLabel(
        episode,
        t("anime.episodeFallbackTitle", { number: episode.episodeNumber }),
      );
      return episode.id === selectedEpisodeId ? `✓ ${label}` : label;
    });
    const cancelButtonIndex = options.length;

    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: t("anime.selectEpisode"),
        options: [...options, cancelLabel],
        cancelButtonIndex,
        tintColor: theme.colors.accent,
      },
      (buttonIndex) => {
        if (buttonIndex === cancelButtonIndex) return;
        const target = episodes[buttonIndex];
        if (target) {
          handleSelectEpisode(target);
        }
      },
    );
  }, [
    handleSelectEpisode,
    language,
    pageData?.episodes,
    selectedEpisodeId,
    t,
    theme.colors.accent,
  ]);

  const handleEpisodePickerValueChange = useCallback(
    (value: string | number) => {
      const episodeId = String(value || "").trim();
      if (!episodeId || episodeId === selectedEpisodeId) return;
      const target = pageData?.episodes.find(
        (episode) => episode.id === episodeId,
      );
      if (target) {
        handleSelectEpisode(target);
      }
    },
    [handleSelectEpisode, pageData?.episodes, selectedEpisodeId],
  );

  const handleSelectPlayer = useCallback(
    async (playerId: string) => {
      triggerSelectionHaptic();
      const currentPlayer =
        playback?.players.find((player) => player.id === playerId) || null;
      const isCurrentPlayerResolved = Boolean(
        currentPlayer?.srcResolved ||
        Object.keys(currentPlayer?.qualityLinks || {}).length > 0,
      );
      if (currentPlayer?.teamSlug) {
        persistPreferredTeamSlug(currentPlayer.teamSlug);
        pendingHistoryTeamSlugRef.current = currentPlayer.teamSlug;
      }
      if (!selectedEpisodeId || !currentPlayer) return;

      // Invalidate cache so next episode load picks up the new preferred team
      if (selectedEpisodeId) {
        invalidateEpisodePlaybackCache(selectedEpisodeId);
      }

      if (isCurrentPlayerResolved) {
        setSelectedPlayerId(playerId);
        setSelectedQuality(
          pickPreferredQualityWithFallback(
            currentPlayer,
            pendingHistoryQualityRef.current,
          ),
        );
        return;
      }

      await loadPlayback(selectedEpisodeId, playerId);
    },
    [
      loadPlayback,
      persistPreferredTeamSlug,
      playback?.players,
      selectedEpisodeId,
    ],
  );

  const handleSelectQuality = useCallback((quality: string) => {
    triggerSelectionHaptic();
    pendingHistoryQualityRef.current = quality;
    preferredQualityRef.current = quality;
    persistPreferredQuality(quality);
    setSelectedQuality(quality);
  }, [persistPreferredQuality]);

  const openPlayerSelector = useCallback(() => {
    if (Platform.OS !== "ios") return;

    const players = playback?.players || [];
    if (!players.length) return;

    const cancelLabel = language === "ru" ? "Отмена" : "Cancel";
    const options = players.map((playerOption) =>
      displayPlayerLabel(
        playerOption,
        language,
        t("anime.unknownTeam"),
        t("anime.unknownTranslation"),
      ),
    );
    const cancelButtonIndex = options.length;

    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: t("anime.selectVoice"),
        options: [...options, cancelLabel],
        cancelButtonIndex,
        tintColor: theme.colors.accent,
      },
      (buttonIndex) => {
        if (buttonIndex === cancelButtonIndex) return;
        const target = players[buttonIndex];
        if (target) {
          void handleSelectPlayer(target.id);
        }
      },
    );
  }, [handleSelectPlayer, language, playback?.players, t, theme.colors.accent]);

  const handlePlayerPickerValueChange = useCallback(
    (value: string | number) => {
      const playerId = String(value || "").trim();
      if (!playerId || playerId === selectedPlayerId) return;
      void handleSelectPlayer(playerId);
    },
    [handleSelectPlayer, selectedPlayerId],
  );

  const openQualitySelector = useCallback(() => {
    if (Platform.OS !== "ios") return;
    if (qualityOptions.length <= 1) return;

    const cancelLabel = language === "ru" ? "Отмена" : "Cancel";
    const options = qualityOptions.map((quality) => `${quality}p`);
    const cancelButtonIndex = options.length;

    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: t("anime.selectQuality"),
        options: [...options, cancelLabel],
        cancelButtonIndex,
        tintColor: theme.colors.accent,
      },
      (buttonIndex) => {
        if (buttonIndex === cancelButtonIndex) return;
        const quality = qualityOptions[buttonIndex];
        if (quality) {
          handleSelectQuality(quality);
        }
      },
    );
  }, [handleSelectQuality, language, qualityOptions, t, theme.colors.accent]);

  const handleQualityPickerValueChange = useCallback(
    (value: string | number) => {
      const quality = String(value || "").trim();
      if (!quality || quality === selectedQuality) return;
      handleSelectQuality(quality);
    },
    [handleSelectQuality, selectedQuality],
  );

  const getDownloadStateForEpisode = useCallback(
    (episodeId: string, teamSlug: string | null, quality: string | null) => {
      const targetId = buildDownloadId(episodeId, teamSlug, quality);
      const exact = downloadItems.find((item) => item.id === targetId);
      if (!exact) return null;

      const rawProgress = Number(exact.progress ?? 0);
      const progress =
        exact.status === "completed"
          ? 1
          : Number.isFinite(rawProgress)
            ? Math.max(0, Math.min(rawProgress, 1))
            : 0;

      return {
        status: exact.status,
        progress,
      } as const;
    },
    [downloadItems],
  );

  const resolveDownloadPlayer = useCallback(
    async (episodeId: string, preferredTeamSlug?: string | null) => {
      const existingPlayback = playbackRef.current;
      let payload =
        existingPlayback?.id === episodeId &&
        (existingPlayback?.players?.length ?? 0) > 0
          ? existingPlayback
          : await api.episode(episodeId);
      let selectedPlayer =
        payload.players.find(
          (playerOption) =>
            playerOption.teamSlug === (preferredTeamSlug || null),
        ) ||
        payload.players[0] ||
        null;

      if (!selectedPlayer) {
        return { payload, selectedPlayer: null };
      }

      const unresolved =
        !selectedPlayer.srcResolved &&
        Object.keys(selectedPlayer.qualityLinks || {}).length === 0 &&
        !payload.resolvedPlayerIds.includes(selectedPlayer.id) &&
        Boolean(selectedPlayer.src);

      if (unresolved) {
        try {
          const resolvedPayload = await api.episode(episodeId, {
            playerId: selectedPlayer.id,
          });
          payload = mergePlaybackPlayers(payload, resolvedPayload);
          selectedPlayer =
            payload.players.find((item) => item.id === selectedPlayer?.id) ||
            selectedPlayer;
        } catch {
          // ignore resolve errors and keep fallback urls
        }
      }

      return { payload, selectedPlayer };
    },
    [],
  );

  const syncDownloadSheetMeta = useCallback(
    async (
      anchorEpisodeId: string,
      preferredTeamSlug?: string | null,
      preferredQuality?: string | null,
    ) => {
      const requestId = ++downloadSheetRequestIdRef.current;
      setDownloadSheetMetaLoading(true);

      try {
        const resolved = await resolveDownloadPlayer(
          anchorEpisodeId,
          preferredTeamSlug,
        );
        const players = resolved.payload.players || [];
        const selectedPlayer =
          players.find(
            (playerOption) =>
              playerOption.teamSlug === (preferredTeamSlug || null),
          ) ||
          resolved.selectedPlayer ||
          players[0] ||
          null;

        if (requestId !== downloadSheetRequestIdRef.current) return false;

        if (!selectedPlayer) {
          setDownloadSheetPlayers([]);
          setDownloadSheetQualities([]);
          setDownloadSheetTeamSlug(null);
          setDownloadSheetQuality(null);
          return false;
        }

        const nextTeamSlug = selectedPlayer.teamSlug || null;
        const qualityOptions = sortQualities(
          Object.keys(selectedPlayer.qualityLinks || {}),
        );
        let nextQuality = String(preferredQuality || "").trim() || null;
        if (qualityOptions.length > 0) {
          if (!nextQuality || !selectedPlayer.qualityLinks[nextQuality]) {
            nextQuality = qualityOptions[0] || null;
          }
        } else {
          nextQuality = pickPreferredQualityWithFallback(
            selectedPlayer,
            nextQuality,
          );
        }

        setDownloadSheetPlayers(players);
        setDownloadSheetTeamSlug(nextTeamSlug);
        setDownloadSheetQualities(qualityOptions);
        setDownloadSheetQuality(nextQuality);
        return true;
      } catch {
        if (requestId === downloadSheetRequestIdRef.current) {
          setDownloadSheetPlayers([]);
          setDownloadSheetQualities([]);
          setDownloadSheetTeamSlug(null);
          setDownloadSheetQuality(null);
        }
        return false;
      } finally {
        if (requestId === downloadSheetRequestIdRef.current) {
          setDownloadSheetMetaLoading(false);
        }
      }
    },
    [resolveDownloadPlayer],
  );

  const handleOpenDownloadMenu = useCallback(() => {
    if (!pageData?.details) return;

    triggerImpactHaptic(Haptics.ImpactFeedbackStyle.Light);

    const defaultEpisodeId =
      selectedEpisodeId || pageData.episodes[0]?.id || null;

    setDownloadFlowLoading(true);
    setDownloadSheetMetaLoading(true);
    setDownloadSheetEpisodeIds(defaultEpisodeId ? [defaultEpisodeId] : []);
    setDownloadSheetTeamSlug(selectedTeamSlug || null);
    setDownloadSheetQuality(effectiveQuality || null);
    setDownloadSheetPlayers([]);
    setDownloadSheetQualities([]);
    setDownloadSheetAllEpisodes(pageData.episodes);
    setDownloadSheetPresented(true);

    // In offline mode — also fetch full episode list from API in background
    if (isOfflineOnly) {
      void api.episodesByAnimeId(pageData.details.animeId).then((allEps) => {
        if (allEps.length > 0) {
          setDownloadSheetAllEpisodes(allEps);
          if (!defaultEpisodeId) {
            const firstId = allEps[0]?.id;
            if (firstId) setDownloadSheetEpisodeIds([firstId]);
          }
        }
      }).catch(() => {});
    }

    if (defaultEpisodeId) {
      void syncDownloadSheetMeta(
        defaultEpisodeId,
        selectedTeamSlug || null,
        effectiveQuality || null,
      ).finally(() => setDownloadFlowLoading(false));
    } else {
      setDownloadFlowLoading(false);
      setDownloadSheetMetaLoading(false);
    }
  }, [
    effectiveQuality,
    isOfflineOnly,
    pageData?.details,
    pageData?.episodes,
    selectedEpisodeId,
    selectedTeamSlug,
    syncDownloadSheetMeta,
  ]);

  // Kept for reference but no longer used as a separate entry point
  const handleOpenOfflineDownloadMenu = handleOpenDownloadMenu;

  // Episodes that have any download record for this anime — declared before
  // the navigation.setOptions useEffect that references animeDownloadItems.length
  const animeDownloadItems = useMemo(
    () => (slug ? downloadItems.filter((item) => item.animeId === slug) : []),
    [downloadItems, slug],
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: !playerOnlyLaunchActive,
      headerRight: playerOnlyLaunchActive
        ? undefined
        : () => (
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Pressable
                onPress={handleOpenDownloadMenu}
                disabled={!isOnline}
                hitSlop={8}
                style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
              >
                <Ionicons
                  name="cloud-download-outline"
                  size={24}
                  color={!isOnline ? theme.colors.muted : theme.colors.accent}
                />
              </Pressable>
              <Pressable
                onPress={() => {
                  if (animeDownloadItems.length === 0) return;
                  triggerImpactHaptic(Haptics.ImpactFeedbackStyle.Light);
                  setDeleteSheetPresented(true);
                }}
                hitSlop={8}
                style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
              >
                <Ionicons
                  name="trash-outline"
                  size={24}
                  color={theme.colors.accent}
                />
              </Pressable>
              <Pressable
                onPress={handleToggleBookmark}
                hitSlop={8}
                style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
              >
                <Ionicons
                  name={bookmarked ? "bookmark" : "bookmark-outline"}
                  size={24}
                  color={theme.colors.accent}
                />
              </Pressable>
            </View>
          ),
    });
  }, [
    animeDownloadItems.length,
    bookmarked,
    handleOpenDownloadMenu,
    handleToggleBookmark,
    isOnline,
    navigation,
    playerOnlyLaunchActive,
    theme.colors.accent,
    theme.colors.muted,
  ]);

  const handleCloseDownloadMenu = useCallback(() => {
    setDownloadSheetPresented(false);
  }, []);

  const handleDeleteEpisode = useCallback(
    (item: DownloadItem) => {
      triggerImpactHaptic(Haptics.ImpactFeedbackStyle.Medium);
      cancelDownload(item.id);
      void removeDownload(item.id).then(() =>
        removeOfflinePayload(item.storageDirUri)
      );
    },
    [],
  );

  const handleDownloadSheetPresentedChange = useCallback(
    (isPresented: boolean) => {
      setDownloadSheetPresented(isPresented);
      if (!isPresented) {
        setDownloadSheetMetaLoading(false);
        setDownloadQueueing(false);
        setDownloadSheetAllEpisodes([]);
      }
    },
    [],
  );

  const toggleDownloadSheetEpisode = useCallback((episodeId: string) => {
    setDownloadSheetEpisodeIds((prev) => {
      const exists = prev.includes(episodeId);
      if (exists) {
        const next = prev.filter((id) => id !== episodeId);
        return next.length ? next : prev;
      }
      return [...prev, episodeId];
    });
  }, []);

  useEffect(() => {
    if (!downloadSheetEpisodeIds.length) return;
    if (!downloadSheetPlayers.length && !downloadSheetMetaLoading) return;

    const anchorEpisodeId = downloadSheetEpisodeIds[0];
    if (!anchorEpisodeId) return;

    void syncDownloadSheetMeta(
      anchorEpisodeId,
      downloadSheetTeamSlug,
      downloadSheetQuality,
    );
    // We intentionally react only to anchor changes to avoid refetch loops after state writes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [downloadSheetEpisodeIds[0]]);

  const handleSelectDownloadSheetVoice = useCallback(
    async (teamSlug: string | null) => {
      const anchorEpisodeId = downloadSheetEpisodeIds[0];
      if (!anchorEpisodeId) return;
      triggerSelectionHaptic();
      await syncDownloadSheetMeta(
        anchorEpisodeId,
        teamSlug,
        downloadSheetQuality,
      );
    },
    [downloadSheetEpisodeIds, downloadSheetQuality, syncDownloadSheetMeta],
  );

  const handleSelectDownloadSheetQuality = useCallback((quality: string) => {
    triggerSelectionHaptic();
    setDownloadSheetQuality(quality);
  }, []);

  const openDownloadSheetVoicePicker = useCallback(() => {
    if (downloadSheetPlayers.length === 0 || Platform.OS !== "ios") return;
    triggerSelectionHaptic();
    const options = downloadSheetPlayers.map((p) =>
      displayPlayerLabel(
        p,
        language,
        t("anime.unknownTeam"),
        t("anime.unknownTranslation"),
      ),
    );
    const cancelLabel = language === "ru" ? "Отмена" : "Cancel";
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: t("anime.selectVoice"),
        options: [...options, cancelLabel],
        cancelButtonIndex: options.length,
        tintColor: theme.colors.accent,
      },
      (idx) => {
        if (idx === options.length) return;
        const p = downloadSheetPlayers[idx];
        if (p) void handleSelectDownloadSheetVoice(p.teamSlug || null);
      },
    );
  }, [
    downloadSheetPlayers,
    handleSelectDownloadSheetVoice,
    language,
    t,
    theme.colors.accent,
  ]);

  const openDownloadSheetQualityPicker = useCallback(() => {
    if (downloadSheetQualities.length === 0 || Platform.OS !== "ios") return;
    triggerSelectionHaptic();
    const cancelLabel = language === "ru" ? "Отмена" : "Cancel";
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: t("anime.selectQuality"),
        options: [...downloadSheetQualities.map((q) => `${q}p`), cancelLabel],
        cancelButtonIndex: downloadSheetQualities.length,
        tintColor: theme.colors.accent,
      },
      (idx) => {
        if (idx === downloadSheetQualities.length) return;
        const q = downloadSheetQualities[idx];
        if (q) handleSelectDownloadSheetQuality(q);
      },
    );
  }, [
    downloadSheetQualities,
    handleSelectDownloadSheetQuality,
    language,
    t,
    theme.colors.accent,
  ]);

  const handleQueueDownloadSelection = useCallback(() => {
    if (
      !pageData?.details ||
      !downloadSheetAllEpisodes.length ||
      !downloadSheetEpisodeIds.length ||
      downloadQueueing
    )
      return;

    const details = pageData.details;
    const selectedIds = [...downloadSheetEpisodeIds];
    setDownloadQueueing(true);

    void (async () => {
      let queuedCount = 0;
      let skippedCount = 0;
      const animeTitle =
        getTitleText(details.title, language) || t("anime.defaultTitle");

      for (const episodeId of selectedIds) {
        const episode = downloadSheetAllEpisodes.find(
          (entry) => entry.id === episodeId,
        );
        if (!episode) {
          skippedCount += 1;
          continue;
        }

        const resolved = await resolveDownloadPlayer(
          episode.id,
          downloadSheetTeamSlug,
        );
        const selectedPlayer = resolved.selectedPlayer;
        if (!selectedPlayer) {
          skippedCount += 1;
          continue;
        }

        let quality = String(downloadSheetQuality || "").trim() || null;
        if (quality && !selectedPlayer.qualityLinks[quality]) {
          quality = pickPreferredQuality(selectedPlayer);
        }
        const resolvedStreamUrl = resolveStreamUrl(selectedPlayer, quality);
        if (!resolvedStreamUrl) {
          skippedCount += 1;
          continue;
        }

        const downloadId = buildDownloadId(
          episode.id,
          selectedPlayer.teamSlug || downloadSheetTeamSlug || null,
          quality,
        );
        const existing = downloadItems.find((item) => item.id === downloadId);
        if (
          existing?.status === "queued" ||
          existing?.status === "downloading"
        ) {
          skippedCount += 1;
          continue;
        }

        await enqueueEpisodeDownload({
          animeId: details.slug,
          animeTitle,
          animeTitleByLanguage: details.title,
          cover: details.cover || null,
          shikimoriId: details.shikimoriHref ? String(details.shikimoriHref).split('/').pop() || null : null,
          anilistId: details.anilistHref ? String(details.anilistHref).split('/').pop() || null : null,
          episodeId: episode.id,
          episodeTitle: episode.title,
          episodeNumber: episode.episodeNumber,
          teamSlug: selectedPlayer.teamSlug || downloadSheetTeamSlug || null,
          teamName: selectedPlayer.teamName || null,
          translationType: selectedPlayer.translationType || null,
          quality,
          streamUrl: resolvedStreamUrl,
          headers: {
            Accept: "*/*",
            "User-Agent": USER_AGENT,
          },
        });
        queuedCount += 1;
      }

      if (queuedCount > 0) {
        triggerNotificationHaptic(Haptics.NotificationFeedbackType.Success);
        // Don't close the sheet — let user add more episodes
        // Just clear the selection so they can pick new ones
        setDownloadSheetEpisodeIds([]);
      } else {
        triggerNotificationHaptic(Haptics.NotificationFeedbackType.Warning);
      }

      if (skippedCount > 0 && queuedCount === 0) {
        Alert.alert(
          t("anime.downloadEpisode"),
          language === "ru"
            ? `Добавлено: ${queuedCount}\nПропущено: ${skippedCount}`
            : `Added: ${queuedCount}\nSkipped: ${skippedCount}`,
        );
      }
    })()
      .catch(() => {
        triggerNotificationHaptic(Haptics.NotificationFeedbackType.Error);
        Alert.alert(t("anime.error"), t("anime.downloadFailed"));
      })
      .finally(() => {
        setDownloadQueueing(false);
      });
  }, [
    downloadItems,
    downloadQueueing,
    downloadSheetAllEpisodes,
    downloadSheetEpisodeIds,
    downloadSheetQuality,
    downloadSheetTeamSlug,
    language,
    pageData?.details,
    resolveDownloadPlayer,
    t,
  ]);

  const getDownloadEpisodeState = useCallback(
    (episodeId: string) => {
      const state = getDownloadStateForEpisode(
        episodeId,
        downloadSheetTeamSlug,
        downloadSheetQuality,
      );
      if (!state) return null;

      if (state.status === "completed") {
        return {
          label: language === "ru" ? "Оффлайн" : "Offline",
          progress: 1,
          showProgress: true,
        } as const;
      }

      if (state.status === "queued") {
        return {
          label: language === "ru" ? "В очереди" : "Queued",
          progress: 0,
          showProgress: true,
        } as const;
      }

      if (state.status === "downloading") {
        return {
          label: language === "ru" ? "Загрузка" : "Downloading",
          progress: state.progress,
          showProgress: true,
        } as const;
      }

      if (state.status === "paused") {
        return {
          label: language === "ru" ? "Пауза" : "Paused",
          progress: state.progress,
          showProgress: true,
        } as const;
      }

      if (state.status === "failed") {
        return {
          label: language === "ru" ? "Ошибка" : "Failed",
          progress: state.progress,
          showProgress: false,
        } as const;
      }

      return null;
    },
    [
      downloadSheetQuality,
      downloadSheetTeamSlug,
      getDownloadStateForEpisode,
      language,
    ],
  );

  const openRelatedAnime = useCallback(
    (item: import("@/lib/api").RelatedAnimeItem) => {
      triggerImpactHaptic(Haptics.ImpactFeedbackStyle.Light);
      router.push({
        pathname: "/anime/[id]",
        params: {
          id: item.slug,
          sourceSlug: slug,
          hintCover: item.cover || "",
          hintName: item.title.jp || item.title.en || item.title.ru || "",
          hintRus: item.title.ru || "",
          hintEng: item.title.en || "",
        },
      });
    },
    [router, slug],
  );

  const openExternalLink = useCallback(
    (href: string) => {
      const targetUrl = String(href || "").trim();
      if (!targetUrl) return;

      triggerImpactHaptic(Haptics.ImpactFeedbackStyle.Light);
      router.push({
        pathname: "/webview",
        params: {
          url: targetUrl,
        },
      });
    },
    [router],
  );

  if (!slug) {
    return (
      <SafeAreaView style={styles.safeArea} edges={["left", "right"]}>
        <View style={styles.container}>
          <StatusCard title={t("anime.error")} message={t("anime.missingId")} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["left", "right"]}>
      <ScrollView
        ref={detailsScrollRef}
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        bounces={false}
        contentContainerStyle={styles.container}
      >
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.colors.indicator} size="large" />
            <Text style={styles.loadingText}>{t("anime.loading")}</Text>
          </View>
        ) : null}

        {!loading && discovering ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.colors.indicator} size="large" />
            <Text style={styles.loadingText}>{t("anime.discovering")}</Text>
            {retryCountdown > 0 ? (
              <Text style={styles.discoveringCountdown}>
                {t("anime.retryIn", { seconds: retryCountdown })}
              </Text>
            ) : null}
          </View>
        ) : null}

        {!loading && !discovering && error ? (
          <StatusCard
            title={t("anime.error")}
            message={error}
            actionLabel={t("anime.retry")}
            onAction={loadPage}
          />
        ) : null}

        {!loading && !error && pageData ? (
          <>
            {!playerOnlyLaunchActive ? (
              <>
                {(() => {
                  const heroBackground = shouldUseCoverAsHeroBackground(
                    pageData.details.background,
                  )
                    ? pageData.details.cover || pageData.details.background
                    : pageData.details.background || pageData.details.cover;
                  return (
                    <View
                      style={[
                        styles.heroBanner,
                        heroBackground
                          ? { marginTop: -16, minHeight: insets.top + 44 + 340 }
                          : null,
                      ]}
                    >
                      {heroBackground ? (
                        <>
                          <ExpoImage
                            source={heroBackground}
                            style={StyleSheet.absoluteFill}
                            contentFit="cover"
                            contentPosition="top"
                          />
                          <BlurView
                            intensity={28}
                            tint="default"
                            style={StyleSheet.absoluteFill}
                          />
                        </>
                      ) : null}
                      {heroBackground ? (
                        <LinearGradient
                          colors={[
                            "transparent",
                            "transparent",
                            theme.colors.background,
                          ]}
                          style={StyleSheet.absoluteFill}
                        />
                      ) : null}
                      <View
                        style={[
                          styles.albumHero,
                          heroBackground
                            ? { paddingTop: insets.top + 56 }
                            : { paddingTop: insets.top + 16 },
                        ]}
                      >
                        <View style={styles.coverFrame}>
                          {pageData.details.cover ? (
                            <ExpoImage
                              source={pageData.details.cover}
                              style={styles.heroCover}
                              contentFit="cover"
                            />
                          ) : (
                            <View
                              style={[styles.heroCover, styles.coverFallback]}
                            >
                              <Text style={styles.coverFallbackText}>
                                {t("anime.noCover")}
                              </Text>
                            </View>
                          )}
                        </View>
                        <Text selectable numberOfLines={3} style={styles.title}>
                          {getTitleText(pageData.details.title, language) ||
                            t("anime.defaultTitle")}
                        </Text>
                        <View style={styles.metaPillRow}>
                          {compactMetaValues(pageData.details, language).map(
                            (value) => (
                              <Text
                                key={value}
                                style={styles.metaPill}
                                numberOfLines={1}
                              >
                                {value}
                              </Text>
                            ),
                          )}
                        </View>
                        <View style={styles.detailGrid}>
                          <Text style={styles.detailMeta}>
                            {t("anime.ageRating")}:{" "}
                            {metaValue(
                              getApiLabelText(
                                pageData.details.ageRating,
                                language,
                              ),
                            )}
                          </Text>
                          <Text style={styles.detailMeta}>
                            {t("anime.releaseDate")}:{" "}
                            {metaValue(
                              getApiLabelText(
                                pageData.details.releaseDate,
                                language,
                              ),
                            )}
                          </Text>
                        </View>
                        {pageData.details.genres.length > 0 ? (
                          <View style={styles.genreRow}>
                            {pageData.details.genres.map((genre) => (
                              <View key={genre.id} style={styles.genreChip}>
                                <Text style={styles.genreChipText}>
                                  {getGenreName(genre, language)}
                                </Text>
                              </View>
                            ))}
                          </View>
                        ) : null}
                      </View>
                    </View>
                  );
                })()}

                {pageData.details.description ? (
                  <View style={styles.descriptionSection}>
                    <SectionHeader title={t("anime.about")} />
                    <Text
                      style={styles.description}
                      numberOfLines={descriptionExpanded ? undefined : 3}
                    >
                      {pageData.details.description}
                    </Text>
                    <Pressable
                      onPress={() => setDescriptionExpanded((v) => !v)}
                    >
                      <Text style={styles.descriptionToggle}>
                        {descriptionExpanded
                          ? t("anime.showLess")
                          : t("anime.showMore")}
                      </Text>
                    </Pressable>
                  </View>
                ) : null}

                {pageData.details.relatedAnime.length > 0 ? (
                  <View style={styles.relatedSection}>
                    <SectionHeader title={t("anime.relatedAnime")} />
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.relatedScroll}
                      style={styles.relatedScrollView}
                    >
                      {pageData.details.relatedAnime.map((item) => (
                        <Pressable
                          key={`${item.relationType}-${item.slug}`}
                          style={styles.relatedCard}
                          onPress={() => openRelatedAnime(item)}
                        >
                          <View style={styles.relatedCover}>
                            {item.cover ? (
                              <ExpoImage
                                source={item.cover}
                                style={styles.relatedCoverImage}
                                contentFit="cover"
                              />
                            ) : (
                              <View
                                style={[
                                  styles.relatedCoverImage,
                                  styles.relatedCoverFallback,
                                ]}
                              />
                            )}
                          </View>
                          <View style={styles.relatedBody}>
                            <Text style={styles.relatedType} numberOfLines={1}>
                              {getApiLabelText(item.relationType, language) ||
                                t("anime.unknownRelation")}
                            </Text>
                            <Text style={styles.relatedTitle} numberOfLines={2}>
                              {getTitleText(item.title, language) || item.slug}
                            </Text>
                          </View>
                        </Pressable>
                      ))}
                    </ScrollView>
                  </View>
                ) : null}

                {pageData.details.sourceManga ||
                pageData.details.shikimoriHref ||
                pageData.details.anilistHref ? (
                  <View style={styles.infoFooter}>
                    {pageData.details.sourceManga ? (
                      <View style={styles.sourceMangaRow}>
                        <Text style={styles.sourceMangaTitle} numberOfLines={1}>
                          {t("anime.sourceManga")}
                          {": "}
                          {getTitleText(
                            pageData.details.sourceManga.title,
                            language,
                          )}
                        </Text>
                      </View>
                    ) : null}

                    {pageData.details.shikimoriHref ||
                    pageData.details.anilistHref ? (
                      <View style={styles.externalLinksRow}>
                        <Text style={styles.externalLinksLabel}>
                          {t("anime.externalLinks")}
                        </Text>
                        <View style={styles.externalLinksBtns}>
                          {pageData.details.shikimoriHref ? (
                            <Pressable
                              style={styles.externalLinkGlassBtn}
                              onPress={() =>
                                openExternalLink(
                                  pageData.details.shikimoriHref!,
                                )
                              }
                            >
                              <View
                                style={[
                                  styles.externalLinkGlassBadge,
                                  styles.externalLinkGlassBadgeShikimori,
                                ]}
                              >
                                <Text style={styles.externalLinkGlassBadgeText}>
                                  SH
                                </Text>
                              </View>
                              <View style={styles.externalLinkGlassTextWrap}>
                                <Text style={styles.externalLinkGlassTitle}>
                                  {t("anime.openOnShikimori")}
                                </Text>
                                <Text style={styles.externalLinkGlassHint}>
                                  shikimori.io
                                </Text>
                              </View>
                              <Text style={styles.externalLinkGlassChevron}>
                                {"›"}
                              </Text>
                            </Pressable>
                          ) : null}
                          {pageData.details.anilistHref ? (
                            <Pressable
                              style={styles.externalLinkGlassBtn}
                              onPress={() =>
                                openExternalLink(pageData.details.anilistHref!)
                              }
                            >
                              <View
                                style={[
                                  styles.externalLinkGlassBadge,
                                  styles.externalLinkGlassBadgeAniList,
                                ]}
                              >
                                <Text style={styles.externalLinkGlassBadgeText}>
                                  AL
                                </Text>
                              </View>
                              <View style={styles.externalLinkGlassTextWrap}>
                                <Text style={styles.externalLinkGlassTitle}>
                                  {t("anime.openOnAniList")}
                                </Text>
                                <Text style={styles.externalLinkGlassHint}>
                                  anilist.co
                                </Text>
                              </View>
                              <Text style={styles.externalLinkGlassChevron}>
                                {"›"}
                              </Text>
                            </Pressable>
                          ) : null}
                        </View>
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </>
            ) : null}

            <View
              style={styles.playerSection}
              onLayout={(event) => {
                if (!shouldScrollToPlayer) return;
                const nextY = event.nativeEvent.layout.y;
                setPlayerSectionY((prev) => (prev === nextY ? prev : nextY));
              }}
            >
              {!playerOnlyLaunchActive ? (
                <View style={styles.playerControls}>
                  {Platform.OS === "ios" ? (
                    <Pressable
                      style={styles.episodeNavLabel}
                      onPress={openEpisodeSelector}
                    >
                      <Text
                        style={styles.episodeNavLabelText}
                        numberOfLines={1}
                      >
                        {selectedEpisode
                          ? displayEpisodeLabel(
                              selectedEpisode,
                              t("anime.episodeFallbackTitle", {
                                number: selectedEpisode.episodeNumber,
                              }),
                            )
                          : t("anime.openSelector")}
                      </Text>
                      <Text style={styles.episodeNavChevron}>{"›"}</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      style={styles.episodeNavLabel}
                      onPress={openEpisodeSelector}
                    >
                      <Text
                        style={styles.episodeNavLabelText}
                        numberOfLines={1}
                      >
                        {selectedEpisode
                          ? displayEpisodeLabel(
                              selectedEpisode,
                              t("anime.episodeFallbackTitle", {
                                number: selectedEpisode.episodeNumber,
                              }),
                            )
                          : t("anime.openSelector")}
                      </Text>
                      <Text style={styles.episodeNavChevron}>{"›"}</Text>
                    </Pressable>
                  )}

                  {Platform.OS === "ios" ? (
                    <Pressable
                      style={[
                        styles.nativeSelectorButton,
                        !hasPlayerOptions &&
                          styles.nativeSelectorButtonDisabled,
                      ]}
                      onPress={openPlayerSelector}
                      disabled={!hasPlayerOptions}
                    >
                      <Text style={styles.nativeSelectorText} numberOfLines={1}>
                        {selectedPlayer
                          ? displayPlayerLabel(
                              selectedPlayer,
                              language,
                              t("anime.unknownTeam"),
                              t("anime.unknownTranslation"),
                            )
                          : t("anime.noPlayers")}
                      </Text>
                      <Text style={styles.nativeSelectorChevron}>{"›"}</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      style={[
                        styles.nativeSelectorButton,
                        !hasPlayerOptions && styles.nativeSelectorButtonDisabled,
                      ]}
                      onPress={() => hasPlayerOptions && setPlayerSheetPresented(true)}
                      disabled={!hasPlayerOptions}
                    >
                      <Text style={styles.nativeSelectorText} numberOfLines={1}>
                        {selectedPlayer
                          ? displayPlayerLabel(
                              selectedPlayer,
                              language,
                              t("anime.unknownTeam"),
                              t("anime.unknownTranslation"),
                            )
                          : t("anime.noPlayers")}
                      </Text>
                      <Text style={styles.nativeSelectorChevron}>{"›"}</Text>
                    </Pressable>
                  )}

                  {Platform.OS === "ios" ? (
                    <Pressable
                      style={[
                        styles.nativeSelectorButton,
                        !hasQualityOptions &&
                          styles.nativeSelectorButtonDisabled,
                      ]}
                      onPress={openQualitySelector}
                      disabled={!hasQualityOptions}
                    >
                      <Text style={styles.nativeSelectorText} numberOfLines={1}>
                        {selectedQuality
                          ? `${selectedQuality}p`
                          : hasQualityOptions
                            ? t("anime.selectQuality")
                            : t("anime.noQualities")}
                      </Text>
                      <Text style={styles.nativeSelectorChevron}>{"›"}</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      style={[
                        styles.nativeSelectorButton,
                        !hasQualityOptions && styles.nativeSelectorButtonDisabled,
                      ]}
                      onPress={() => hasQualityOptions && setQualitySheetPresented(true)}
                      disabled={!hasQualityOptions}
                    >
                      <Text style={styles.nativeSelectorText} numberOfLines={1}>
                        {selectedQuality
                          ? `${selectedQuality}p`
                          : hasQualityOptions
                            ? t("anime.selectQuality")
                            : t("anime.noQualities")}
                      </Text>
                      <Text style={styles.nativeSelectorChevron}>{"›"}</Text>
                    </Pressable>
                  )}

                  {isOfflineOnly &&
                  offlineSelectedEpisodeProgress &&
                  offlineSelectedEpisodeProgress.status !== "downloading" &&
                  offlineSelectedEpisodeProgress.status !== "queued" &&
                  offlineSelectedEpisodeProgress.status !== "completed" &&
                  offlineSelectedEpisodeProgress.status !== "failed" ? (
                    <View style={styles.offlineEpisodeProgressRow}>
                      <View style={styles.offlineEpisodeProgressTopRow}>
                        <Text
                          style={styles.offlineEpisodeProgressLabel}
                          numberOfLines={1}
                        >
                          {t("downloads.status.paused")}
                        </Text>
                        <Text
                          style={styles.offlineEpisodeProgressMeta}
                          numberOfLines={1}
                        >
                          {toPercentLabel(
                            offlineSelectedEpisodeProgress.progress,
                          )}
                        </Text>
                      </View>
                      <View style={styles.offlineEpisodeProgressTrack}>
                        <View
                          style={[
                            styles.offlineEpisodeProgressFill,
                            {
                              width: `${Math.round(offlineSelectedEpisodeProgress.progress * 100)}%`,
                            },
                          ]}
                        />
                      </View>
                    </View>
                  ) : null}
                </View>
              ) : null}

              <View style={styles.playerCard}>
                <VideoView
                  ref={videoViewRef}
                  player={player}
                  style={styles.video}
                  nativeControls
                  contentFit="contain"
                  fullscreenOptions={{ enable: true }}
                  onFirstFrameRender={() => {
                    if (autoFullscreenConsumedRef.current) return;
                    requestAutoFullscreen("first-frame");
                  }}
                  onFullscreenEnter={() => {
                    fullscreenEnteredRef.current = true;
                    clearFullscreenFallbackTimer();
                    triggerImpactHaptic(Haptics.ImpactFeedbackStyle.Medium);
                  }}
                  onFullscreenExit={() => {
                    fullscreenEnteredRef.current = false;
                    clearFullscreenFallbackTimer();
                    if (playerOnlyLaunchActive) {
                      setPlayerOnlyLaunchActive(false);
                    }
                  }}
                />
                {playbackLoading ? (
                  <View style={styles.playerLoadingOverlay}>
                    <ActivityIndicator
                      color={theme.colors.indicator}
                      size="large"
                    />
                    <Text style={styles.loadingText}>
                      {t("anime.loadingStream")}
                    </Text>
                  </View>
                ) : !playbackUri ? (
                  <View style={styles.playerLoadingOverlay}>
                    {isOfflineOnly &&
                    (offlineSelectedEpisodeProgress?.status === "downloading" ||
                      offlineSelectedEpisodeProgress?.status === "queued") ? (
                      <>
                        <ActivityIndicator
                          color={theme.colors.indicator}
                          size="large"
                        />
                        <Text style={styles.loadingText}>
                          {offlineSelectedEpisodeProgress.status === "queued"
                            ? t("downloads.status.queued")
                            : `${t("downloads.status.downloading")} ${toPercentLabel(offlineSelectedEpisodeProgress.progress)}`}
                        </Text>
                      </>
                    ) : isResolvingOfflinePlaylist ? (
                      <ActivityIndicator
                        color={theme.colors.indicator}
                        size="large"
                      />
                    ) : isOfflineOnly ? (
                      <Text style={styles.emptyText}>
                        {language === "ru"
                          ? "Эпизод не скачан на этом устройстве"
                          : "Episode not downloaded on this device"}
                      </Text>
                    ) : (
                      <Text style={styles.emptyText}>
                        {t("anime.playbackUnavailable")}
                      </Text>
                    )}
                  </View>
                ) : null}
              </View>
              {playbackError && !isOfflineOnly &&
              !(
                isOfflineOnly &&
                (offlineSelectedEpisodeProgress?.status === "downloading" ||
                  offlineSelectedEpisodeProgress?.status === "queued" ||
                  offlineSelectedEpisodeProgress?.status === "completed")
              ) ? (
                <Text style={styles.playbackErrorText} numberOfLines={2}>
                  {playbackError}
                </Text>
              ) : null}

              {!playerOnlyLaunchActive ? (
                <View style={styles.episodeNavUnderPlayer}>
                  <Pressable
                    style={[
                      styles.episodeNavBtn,
                      !prevEpisode && styles.episodeNavBtnDisabled,
                    ]}
                    onPress={() =>
                      prevEpisode && handleSelectEpisode(prevEpisode)
                    }
                    disabled={!prevEpisode}
                  >
                    <Text
                      style={[
                        styles.episodeNavBtnText,
                        !prevEpisode && styles.episodeNavBtnTextDisabled,
                      ]}
                    >
                      {"‹"}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.episodeNavBtn,
                      !nextEpisode && styles.episodeNavBtnDisabled,
                    ]}
                    onPress={() =>
                      nextEpisode && handleSelectEpisode(nextEpisode)
                    }
                    disabled={!nextEpisode}
                  >
                    <Text
                      style={[
                        styles.episodeNavBtnText,
                        !nextEpisode && styles.episodeNavBtnTextDisabled,
                      ]}
                    >
                      {"›"}
                    </Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          </>
        ) : null}
      </ScrollView>

      <BottomSheet
        isPresented={downloadSheetPresented}
        onDismiss={() => handleDownloadSheetPresentedChange(false)}
      >
        <SafeAreaView style={styles.downloadSheetSafeArea} edges={["bottom"]}>
          <View style={styles.downloadSheetHeader}>
            <Text style={styles.downloadSheetTitle}>
              {t("anime.downloadEpisode")}
            </Text>
            <Text style={styles.downloadSheetSubtitle}>
              {downloadSheetSelectedCountLabel}
            </Text>
          </View>

          <ScrollView
            contentContainerStyle={styles.downloadSheetScrollContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.downloadSheetSection}>
              <Text style={styles.downloadSheetSectionTitle}>
                {t("anime.selectVoice")}
              </Text>
              {downloadSheetMetaLoading ? (
                <View style={styles.downloadSheetHintRow}>
                  <ActivityIndicator size="small" color={theme.colors.accent} />
                </View>
              ) : downloadSheetPlayers.length === 0 ? (
                <Text style={styles.downloadSheetHint}>
                  {t("anime.noPlayers")}
                </Text>
              ) : (
                <Pressable
                  style={[
                    styles.downloadSheetSelectorRow,
                    downloadSheetMetaLoading &&
                      styles.downloadSheetSelectorRowDisabled,
                  ]}
                  onPress={() => {
                    if (Platform.OS === "ios") {
                      openDownloadSheetVoicePicker();
                    } else {
                      setDlVoiceSheetPresented(true);
                    }
                  }}
                  disabled={downloadSheetMetaLoading}
                >
                  <Text
                    style={styles.downloadSheetSelectorText}
                    numberOfLines={1}
                  >
                    {downloadSheetVoiceLabel}
                  </Text>
                  {downloadSheetPlayers.length > 1 ? (
                    <Text style={styles.downloadSheetSelectorChevron}>
                      {"›"}
                    </Text>
                  ) : null}
                </Pressable>
              )}
            </View>

            <View style={styles.downloadSheetSection}>
              <Text style={styles.downloadSheetSectionTitle}>
                {t("anime.selectQuality")}
              </Text>
              {downloadSheetQualities.length === 0 ? (
                <Text style={styles.downloadSheetHint}>
                  {t("anime.noQualities")}
                </Text>
              ) : (
                <Pressable
                  style={[
                    styles.downloadSheetSelectorRow,
                    downloadSheetMetaLoading &&
                      styles.downloadSheetSelectorRowDisabled,
                  ]}
                  onPress={() => {
                    if (Platform.OS === "ios") {
                      openDownloadSheetQualityPicker();
                    } else {
                      setDlQualitySheetPresented(true);
                    }
                  }}
                  disabled={downloadSheetMetaLoading}
                >
                  <Text
                    style={styles.downloadSheetSelectorText}
                    numberOfLines={1}
                  >
                    {downloadSheetQualityLabel}
                  </Text>
                  {downloadSheetQualities.length > 1 ? (
                    <Text style={styles.downloadSheetSelectorChevron}>
                      {"›"}
                    </Text>
                  ) : null}
                </Pressable>
              )}
            </View>

            <View style={styles.downloadSheetSection}>
              <View style={styles.downloadSheetSectionRow}>
                <Text style={styles.downloadSheetSectionTitle}>
                  {t("anime.selectEpisode")}
                </Text>
                {(downloadSheetAllEpisodes.length ?? 0) > 1 ? (
                  <Pressable
                    onPress={() => {
                      const allIds = downloadSheetAllEpisodes.map((ep) => ep.id);
                      const allSelected =
                        downloadSheetEpisodeIds.length === allIds.length;
                      setDownloadSheetEpisodeIds(allSelected ? [] : allIds);
                    }}
                    disabled={downloadSheetMetaLoading}
                  >
                    <Text style={styles.downloadSheetSectionAction}>
                      {downloadSheetEpisodeIds.length ===
                      downloadSheetAllEpisodes.length
                        ? t("anime.deselectAll")
                        : t("anime.selectAll")}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
              <View style={styles.downloadSheetListGroup}>
                {downloadSheetAllEpisodes.map((episode, index) => {
                  const isSelected = downloadSheetSelectedSet.has(episode.id);
                  const episodeDownloadState = getDownloadEpisodeState(
                    episode.id,
                  );
                  const rawState = getDownloadStateForEpisode(
                    episode.id,
                    downloadSheetTeamSlug,
                    downloadSheetQuality,
                  );
                  // During meta loading, also check with null team/quality to
                  // catch episodes downloaded with any team — avoids visual flicker
                  const rawStateAny = downloadSheetMetaLoading
                    ? getDownloadStateForEpisode(episode.id, null, null)
                    : null;
                  const isUnavailable =
                    rawState?.status === "completed" ||
                    rawState?.status === "downloading" ||
                    rawState?.status === "queued" ||
                    rawStateAny?.status === "completed" ||
                    rawStateAny?.status === "downloading" ||
                    rawStateAny?.status === "queued";
                  const isLast = index === downloadSheetAllEpisodes.length - 1;
                  return (
                    <Pressable
                      key={`download-episode-${episode.id}`}
                      style={[
                        styles.downloadSheetListRow,
                        !isLast && styles.downloadSheetListRowBorder,
                        isUnavailable && styles.downloadSheetListRowUnavailable,
                      ]}
                      onPress={() => !isUnavailable && toggleDownloadSheetEpisode(episode.id)}
                      disabled={downloadSheetMetaLoading || isUnavailable}
                    >
                      <View style={styles.downloadSheetEpisodeTextWrap}>
                        <Text
                          style={styles.downloadSheetEpisodeTitle}
                          numberOfLines={1}
                        >
                          {displayEpisodeLabel(
                            episode,
                            t("anime.episodeFallbackTitle", {
                              number: episode.episodeNumber,
                            }),
                          )}
                        </Text>
                        {episodeDownloadState ? (
                          <View style={styles.downloadSheetEpisodeMetaRow}>
                            <Text style={styles.downloadSheetEpisodeState}>
                              {episodeDownloadState.label}
                            </Text>
                            {episodeDownloadState.showProgress ? (
                              <Text
                                style={
                                  styles.downloadSheetEpisodeProgressPercent
                                }
                              >
                                {toPercentLabel(episodeDownloadState.progress)}
                              </Text>
                            ) : null}
                          </View>
                        ) : null}
                        {episodeDownloadState?.showProgress ? (
                          <View
                            style={styles.downloadSheetEpisodeProgressTrack}
                          >
                            <View
                              style={[
                                styles.downloadSheetEpisodeProgressFill,
                                {
                                  width: `${Math.round(episodeDownloadState.progress * 100)}%`,
                                },
                              ]}
                            />
                          </View>
                        ) : null}
                      </View>
                      <Text
                        style={[
                          styles.downloadSheetListRowCheck,
                          !isSelected && styles.downloadSheetListRowCheckHidden,
                        ]}
                      >
                        {"✓"}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </ScrollView>

          <View style={styles.downloadSheetFooter}>
            <Text style={styles.downloadSheetFooterHint} numberOfLines={1}>
              {downloadSheetVoiceLabel} · {downloadSheetQualityLabel}
            </Text>
            <Pressable
              style={[
                styles.downloadSheetConfirmBtn,
                !downloadSheetCanQueue &&
                  styles.downloadSheetConfirmBtnDisabled,
              ]}
              onPress={handleQueueDownloadSelection}
              disabled={!downloadSheetCanQueue}
            >
              <Text style={styles.downloadSheetConfirmBtnText}>
                {!isOnline
                  ? (language === "ru" ? "Нет интернета" : "No internet")
                  : downloadQueueing
                    ? t("anime.loadingStream")
                    : `${t("anime.downloadEpisode")} (${downloadSheetEpisodeIds.length})`}
              </Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </BottomSheet>

      {/* Android-only: episode selector sheet */}
      {Platform.OS === "android" ? (
        <BottomSheet
          isPresented={episodeSheetPresented}
          onDismiss={() => setEpisodeSheetPresented(false)}
        >
          <ScrollView style={styles.pickerSheetScroll}>
            {(pageData?.episodes || []).map((episode) => {
              const isActive = episode.id === selectedEpisodeId;
              return (
                <Pressable
                  key={episode.id}
                  style={[styles.pickerSheetRow, isActive && styles.pickerSheetRowActive]}
                  onPress={() => {
                    setEpisodeSheetPresented(false);
                    handleSelectEpisode(episode);
                  }}
                >
                  <Text style={[styles.pickerSheetRowText, isActive && styles.pickerSheetRowTextActive]} numberOfLines={1}>
                    {displayEpisodeLabel(episode, t("anime.episodeFallbackTitle", { number: episode.episodeNumber }))}
                  </Text>
                  {isActive ? <Text style={styles.pickerSheetCheck}>{"✓"}</Text> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </BottomSheet>
      ) : null}

      {/* Android-only: player selector sheet */}
      {Platform.OS === "android" ? (
        <BottomSheet
          isPresented={playerSheetPresented}
          onDismiss={() => setPlayerSheetPresented(false)}
        >
          <View style={styles.pickerSheetScroll}>
            {(playback?.players || []).map((playerOption) => {
              const isActive = playerOption.id === selectedPlayerId;
              return (
                <Pressable
                  key={playerOption.id}
                  style={[styles.pickerSheetRow, isActive && styles.pickerSheetRowActive]}
                  onPress={() => {
                    setPlayerSheetPresented(false);
                    void handleSelectPlayer(playerOption.id);
                  }}
                >
                  <Text style={[styles.pickerSheetRowText, isActive && styles.pickerSheetRowTextActive]} numberOfLines={1}>
                    {displayPlayerLabel(playerOption, language, t("anime.unknownTeam"), t("anime.unknownTranslation"))}
                  </Text>
                  {isActive ? <Text style={styles.pickerSheetCheck}>{"✓"}</Text> : null}
                </Pressable>
              );
            })}
          </View>
        </BottomSheet>
      ) : null}

      {/* Android-only: quality selector sheet */}
      {Platform.OS === "android" ? (
        <BottomSheet
          isPresented={qualitySheetPresented}
          onDismiss={() => setQualitySheetPresented(false)}
        >
          <View style={styles.pickerSheetScroll}>
            {qualityOptions.map((quality) => {
              const isActive = quality === (selectedQuality || qualityOptions[0]);
              return (
                <Pressable
                  key={quality}
                  style={[styles.pickerSheetRow, isActive && styles.pickerSheetRowActive]}
                  onPress={() => {
                    setQualitySheetPresented(false);
                    handleSelectQuality(quality);
                  }}
                >
                  <Text style={[styles.pickerSheetRowText, isActive && styles.pickerSheetRowTextActive]}>
                    {`${quality}p`}
                  </Text>
                  {isActive ? <Text style={styles.pickerSheetCheck}>{"✓"}</Text> : null}
                </Pressable>
              );
            })}
          </View>
        </BottomSheet>
      ) : null}

      {/* Android-only: download sheet voice picker */}
      {Platform.OS === "android" ? (
        <BottomSheet
          isPresented={dlVoiceSheetPresented}
          onDismiss={() => setDlVoiceSheetPresented(false)}
        >
          <View style={styles.pickerSheetScroll}>
            {downloadSheetPlayers.map((p) => {
              const isActive = p.teamSlug === downloadSheetTeamSlug;
              return (
                <Pressable
                  key={p.id}
                  style={[styles.pickerSheetRow, isActive && styles.pickerSheetRowActive]}
                  onPress={() => {
                    setDlVoiceSheetPresented(false);
                    void handleSelectDownloadSheetVoice(p.teamSlug || null);
                  }}
                >
                  <Text style={[styles.pickerSheetRowText, isActive && styles.pickerSheetRowTextActive]} numberOfLines={1}>
                    {displayPlayerLabel(p, language, t("anime.unknownTeam"), t("anime.unknownTranslation"))}
                  </Text>
                  {isActive ? <Text style={styles.pickerSheetCheck}>{"✓"}</Text> : null}
                </Pressable>
              );
            })}
          </View>
        </BottomSheet>
      ) : null}

      {/* Android-only: download sheet quality picker */}
      {Platform.OS === "android" ? (
        <BottomSheet
          isPresented={dlQualitySheetPresented}
          onDismiss={() => setDlQualitySheetPresented(false)}
        >
          <View style={styles.pickerSheetScroll}>
            {downloadSheetQualities.map((q) => {
              const isActive = q === downloadSheetQuality;
              return (
                <Pressable
                  key={q}
                  style={[styles.pickerSheetRow, isActive && styles.pickerSheetRowActive]}
                  onPress={() => {
                    setDlQualitySheetPresented(false);
                    handleSelectDownloadSheetQuality(q);
                  }}
                >
                  <Text style={[styles.pickerSheetRowText, isActive && styles.pickerSheetRowTextActive]}>
                    {`${q}p`}
                  </Text>
                  {isActive ? <Text style={styles.pickerSheetCheck}>{"✓"}</Text> : null}
                </Pressable>
              );
            })}
          </View>
        </BottomSheet>
      ) : null}

      {/* Delete episodes sheet */}
      <BottomSheet
        isPresented={deleteSheetPresented}
        onDismiss={() => setDeleteSheetPresented(false)}
        fitToContents={animeDownloadItems.length <= 6}
      >
        <View style={styles.deleteSheetHeader}>
          <Text style={styles.deleteSheetTitle}>
            {language === "ru" ? "Удалить эпизоды" : "Delete episodes"}
          </Text>
        </View>
        <ScrollView
          style={styles.deleteSheetScroll}
          showsVerticalScrollIndicator={false}
        >
          {animeDownloadItems.map((item, index) => {
            const isLast = index === animeDownloadItems.length - 1;
            const statusLabel =
              item.status === "completed"
                ? language === "ru" ? "Скачан" : "Downloaded"
                : item.status === "downloading"
                  ? language === "ru" ? "Загрузка..." : "Downloading..."
                  : item.status === "queued"
                    ? language === "ru" ? "В очереди" : "Queued"
                    : item.status === "failed"
                      ? language === "ru" ? "Ошибка" : "Failed"
                      : item.status;
            return (
              <Pressable
                key={item.id}
                style={[
                  styles.deleteSheetRow,
                  !isLast && styles.deleteSheetRowBorder,
                ]}
                onPress={() => {
                  setDeleteSheetPresented(false);
                  handleDeleteEpisode(item);
                }}
              >
                <View style={styles.deleteSheetRowText}>
                  <Text style={styles.deleteSheetEpisodeTitle} numberOfLines={1}>
                    {`#${item.episodeNumber ?? "?"} · ${item.episodeTitle || (language === "ru" ? "Эпизод" : "Episode")}`}
                  </Text>
                  <Text style={styles.deleteSheetEpisodeStatus}>
                    {statusLabel}
                    {item.teamSlug ? ` · ${item.teamSlug}` : ""}
                    {item.quality ? ` · ${item.quality}p` : ""}
                  </Text>
                </View>
                <Ionicons
                  name="trash-outline"
                  size={18}
                  color={theme.colors.dangerText}
                />
              </Pressable>
            );
          })}
        </ScrollView>
      </BottomSheet>
    </SafeAreaView>
  );
}

const createStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    container: {
      padding: 16,
      paddingBottom: 34,
      gap: 16,
      flexGrow: 1,
    },
    center: {
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 30,
    },
    loadingText: {
      color: theme.colors.muted,
      marginTop: 8,
    },
    albumHero: {
      alignItems: "center",
      paddingHorizontal: 24,
      paddingBottom: 24,
      gap: 13,
    },
    heroBanner: {
      marginHorizontal: -16,
      overflow: "hidden",
    },
    heroGlow: {
      position: "absolute",
      left: -20,
      right: -20,
      top: 0,
      height: 260,
      opacity: 0.72,
    },
    coverFrame: {
      borderRadius: 22,
      backgroundColor: theme.colors.panelSoft,
    },
    heroCover: {
      width: 214,
      height: 300,
      borderRadius: 22,
      backgroundColor: theme.colors.panelSoft,
    },
    coverFallback: {
      alignItems: "center",
      justifyContent: "center",
    },
    coverFallbackText: {
      color: theme.colors.muted,
      fontSize: 10,
      fontWeight: "800",
    },
    title: {
      color: theme.colors.text,
      fontWeight: "900",
      fontSize: 26,
      lineHeight: 31,
      textAlign: "center",
      maxWidth: 330,
    },
    metaPillRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "center",
      gap: 8,
    },
    metaPill: {
      color: theme.colors.accentSoft,
      backgroundColor: theme.colors.panelSoft,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.colors.accentSurface,
      overflow: "hidden",
      paddingHorizontal: 11,
      paddingVertical: 6,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "800",
    },
    detailGrid: {
      width: "100%",
      gap: 5,
      alignItems: "center",
    },
    detailMeta: {
      color: theme.colors.secondaryText,
      fontSize: 12,
      lineHeight: 17,
    },
    surfaceSection: {
      backgroundColor: theme.colors.panel,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: 16,
      gap: 10,
    },
    description: {
      color: theme.colors.text,
      lineHeight: 21,
      fontSize: 14,
    },
    playerSection: {
      marginHorizontal: -16,
      marginBottom: -34,
      gap: 0,
    },
    playerControls: {
      gap: 12,
      paddingHorizontal: 16,
      paddingBottom: 12,
    },
    genreRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
      marginTop: 4,
    },
    genreChip: {
      backgroundColor: theme.colors.panelSoft,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    genreChipText: {
      color: theme.colors.muted,
      fontSize: 11,
      fontWeight: "600",
    },
    relatedSection: {
      gap: 10,
    },
    relatedScrollView: {
      marginHorizontal: -16,
    },
    relatedScroll: {
      gap: 10,
      paddingHorizontal: 16,
      paddingBottom: 2,
    },
    relatedCard: {
      width: 130,
      borderRadius: 14,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.panel,
    },
    relatedCover: {},
    relatedCoverImage: {
      width: 130,
      aspectRatio: 2 / 3,
      backgroundColor: theme.colors.panelSoft,
      borderRadius: 13,
    },
    relatedCoverFallback: {
      backgroundColor: theme.colors.panelSoft,
    },
    relatedBody: {
      padding: 8,
      gap: 4,
    },
    relatedType: {
      color: theme.colors.accent,
      fontSize: 10,
      fontWeight: "700",
    },
    relatedTitle: {
      color: theme.colors.text,
      fontSize: 12,
      fontWeight: "700",
      lineHeight: 16,
    },
    sectionHint: {
      color: theme.colors.muted,
      fontSize: 12,
      lineHeight: 18,
    },
    playerCard: {
      overflow: "hidden",
      backgroundColor: theme.colors.playbackSurface,
      width: "100%",
      aspectRatio: 16 / 9,
    },
    playerLoading: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: 16,
    },
    playerLoadingOverlay: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      alignItems: "center",
      justifyContent: "center",
      padding: 16,
      backgroundColor: theme.colors.playbackSurface,
    },
    video: {
      width: "100%",
      height: "100%",
      backgroundColor: theme.colors.playbackSurface,
    },
    playerMeta: {
      backgroundColor: theme.colors.playbackSurface,
      paddingHorizontal: 12,
      paddingVertical: 10,
      gap: 4,
    },
    playerMetaText: {
      color: theme.colors.playbackText,
      fontSize: 12,
    },
    episodeNav: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    episodeNavBtn: {
      flex: 1,
      height: 52,
      borderRadius: 14,
      backgroundColor: theme.colors.panelSoft,
      alignItems: "center",
      justifyContent: "center",
    },
    episodeNavBtnDisabled: {
      opacity: 0.3,
    },
    episodeNavBtnText: {
      fontSize: 30,
      lineHeight: 34,
      color: theme.colors.text,
      fontWeight: "600",
    },
    episodeNavBtnTextDisabled: {
      color: theme.colors.muted,
    },
    episodeNavLabel: {
      height: 40,
      borderRadius: 12,
      backgroundColor: theme.colors.panelSoft,
      paddingHorizontal: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    episodeNavLabelText: {
      flex: 1,
      color: theme.colors.text,
      fontWeight: "600",
      fontSize: 14,
    },
    episodeNavChevron: {
      color: theme.colors.accent,
      fontSize: 14,
    },
    episodeNavUnderPlayer: {
      flexDirection: "row",
      alignItems: "stretch",
      width: "100%",
      gap: 10,
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: 12,
    },
    episodePickerWrap: {
      flex: 1,
      borderRadius: 12,
      backgroundColor: theme.colors.panelSoft,
      justifyContent: "center",
    },
    episodePicker: {
      color: theme.colors.text,
      backgroundColor: theme.colors.panelSoft,
    },
    nativeSelectorButton: {
      height: 40,
      borderRadius: 12,
      backgroundColor: theme.colors.panelSoft,
      paddingHorizontal: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    nativeSelectorButtonDisabled: {
      opacity: 0.6,
    },
    nativeSelectorText: {
      flex: 1,
      color: theme.colors.text,
      fontSize: 14,
      fontWeight: "600",
    },
    nativeSelectorChevron: {
      color: theme.colors.accent,
      fontSize: 14,
    },
    nativePickerWrap: {
      borderRadius: 12,
      backgroundColor: theme.colors.panelSoft,
      justifyContent: "center",
    },
    nativePicker: {
      color: theme.colors.text,
      backgroundColor: theme.colors.panelSoft,
    },
    downloadEpisodeStatus: {
      color: theme.colors.muted,
      fontSize: 12,
      lineHeight: 16,
      marginTop: -4,
    },
    playbackErrorText: {
      color: theme.colors.dangerText,
      fontSize: 12,
      lineHeight: 16,
      marginTop: 6,
      marginHorizontal: 2,
    },
    offlineEpisodeProgressList: {
      paddingHorizontal: 16,
      paddingTop: 4,
      gap: 8,
    },
    offlineEpisodeProgressRow: {
      gap: 4,
    },
    offlineEpisodeProgressTopRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
    },
    offlineEpisodeProgressLabel: {
      flex: 1,
      color: theme.colors.muted,
      fontSize: 11,
      lineHeight: 14,
    },
    offlineEpisodeProgressMeta: {
      color: theme.colors.muted,
      fontSize: 11,
      lineHeight: 14,
      textAlign: "right",
    },
    offlineEpisodeProgressTrack: {
      height: 4,
      borderRadius: 999,
      backgroundColor: theme.colors.accentSurface,
      overflow: "hidden",
    },
    offlineEpisodeProgressFill: {
      height: "100%",
      borderRadius: 999,
      backgroundColor: theme.colors.accent,
    },
    animeProgressContainer: {
      paddingHorizontal: 16,
      paddingTop: 4,
      gap: 5,
    },
    animeProgressMeta: {
      color: theme.colors.muted,
      fontSize: 11,
      lineHeight: 14,
    },
    animeProgressRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    animeProgressTrack: {
      flex: 1,
      height: 4,
      borderRadius: 999,
      backgroundColor: theme.colors.accentSurface,
      overflow: "hidden",
    },
    animeProgressPercent: {
      color: theme.colors.muted,
      fontSize: 11,
      lineHeight: 14,
      minWidth: 32,
      textAlign: "right",
    },
    animeProgressFill: {
      height: "100%",
      borderRadius: 999,
      backgroundColor: theme.colors.accent,
    },
    downloadSheetSafeArea: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    downloadSheetHandle: {
      alignItems: "center",
      paddingTop: 10,
      paddingBottom: 4,
    },
    downloadSheetHandleBar: {
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: theme.colors.border,
    },
    downloadSheetHeader: {
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 16,
      gap: 4,
    },
    downloadSheetTitle: {
      color: theme.colors.text,
      fontSize: 20,
      lineHeight: 26,
      fontWeight: "800",
    },
    downloadSheetSubtitle: {
      color: theme.colors.muted,
      fontSize: 13,
      lineHeight: 17,
    },
    downloadSheetScrollContent: {
      paddingHorizontal: 16,
      paddingBottom: 16,
      gap: 20,
    },
    downloadSheetSection: {
      gap: 10,
    },
    downloadSheetSectionRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    downloadSheetSectionTitle: {
      color: theme.colors.muted,
      fontSize: 11,
      lineHeight: 15,
      fontWeight: "600",
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    downloadSheetSectionAction: {
      color: theme.colors.accent,
      fontSize: 13,
      lineHeight: 17,
      fontWeight: "600",
    },
    downloadSheetHintRow: {
      minHeight: 44,
      justifyContent: "center",
    },
    downloadSheetHint: {
      color: theme.colors.muted,
      fontSize: 13,
      lineHeight: 17,
    },
    downloadSheetChipRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    downloadSheetChip: {
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.panelSoft,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    downloadSheetChipSelected: {
      borderColor: theme.colors.accent,
      backgroundColor: theme.colors.accentSurface,
    },
    downloadSheetChipText: {
      color: theme.colors.text,
      fontSize: 13,
      lineHeight: 17,
      fontWeight: "600",
    },
    downloadSheetChipTextSelected: {
      color: theme.colors.accent,
    },
    downloadSheetSelectorRow: {
      height: 44,
      borderRadius: 12,
      backgroundColor: theme.colors.backgroundAlt,
      borderWidth: 1,
      borderColor: theme.colors.border,
      paddingHorizontal: 14,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    downloadSheetSelectorRowDisabled: {
      opacity: 0.6,
    },
    downloadSheetSelectorText: {
      flex: 1,
      color: theme.colors.text,
      fontSize: 15,
      lineHeight: 20,
      fontWeight: "500",
    },
    downloadSheetSelectorChevron: {
      color: theme.colors.accent,
      fontSize: 16,
      lineHeight: 20,
    },
    downloadSheetListGroup: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.border,
      overflow: "hidden",
    },
    downloadSheetListRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 14,
      paddingVertical: 12,
      backgroundColor: theme.colors.backgroundAlt,
      gap: 10,
      minHeight: 44,
    },
    downloadSheetListRowBorder: {
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    downloadSheetListRowUnavailable: {
      opacity: 0.45,
    },
    downloadSheetListRowLabel: {
      flex: 1,
      color: theme.colors.text,
      fontSize: 15,
      lineHeight: 20,
    },
    downloadSheetListRowCheck: {
      color: theme.colors.accent,
      fontSize: 17,
      lineHeight: 22,
      fontWeight: "700",
    },
    downloadSheetListRowCheckHidden: {
      opacity: 0,
    },
    downloadSheetEpisodeTextWrap: {
      flex: 1,
      gap: 2,
    },
    downloadSheetEpisodeTitle: {
      color: theme.colors.text,
      fontSize: 15,
      lineHeight: 20,
    },
    downloadSheetEpisodeState: {
      color: theme.colors.muted,
      fontSize: 11,
      lineHeight: 14,
    },
    downloadSheetEpisodeMetaRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
    },
    downloadSheetEpisodeProgressPercent: {
      color: theme.colors.muted,
      fontSize: 11,
      lineHeight: 14,
      minWidth: 34,
      textAlign: "right",
    },
    downloadSheetEpisodeProgressTrack: {
      marginTop: 4,
      height: 4,
      borderRadius: 999,
      backgroundColor: theme.colors.accentSurface,
      overflow: "hidden",
    },
    downloadSheetEpisodeProgressFill: {
      height: "100%",
      borderRadius: 999,
      backgroundColor: theme.colors.accent,
    },
    downloadSheetFooter: {
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: 14,
      gap: 10,
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
      backgroundColor: theme.colors.background,
    },
    downloadSheetFooterHint: {
      color: theme.colors.muted,
      fontSize: 12,
      lineHeight: 16,
      textAlign: "center",
    },
    downloadSheetConfirmBtn: {
      minHeight: 50,
      borderRadius: 14,
      backgroundColor: theme.colors.accent,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 12,
    },
    downloadSheetConfirmBtnDisabled: {
      opacity: 0.5,
    },
    downloadSheetConfirmBtnText: {
      color: "#FFFFFF",
      fontSize: 15,
      lineHeight: 20,
      fontWeight: "700",
    },
    infoFooter: {
      gap: 16,
      paddingBottom: 16,
    },
    scoreRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    scoreStar: {
      color: theme.colors.accent,
      fontSize: 20,
    },
    scoreValue: {
      color: theme.colors.text,
      fontSize: 22,
      fontWeight: "700",
    },
    sourceMangaRow: {
      gap: 2,
    },
    sourceMangaLabel: {
      color: theme.colors.muted,
      fontSize: 11,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    sourceMangaTitle: {
      color: theme.colors.text,
      fontSize: 14,
      fontWeight: "500",
    },
    externalLinksRow: {
      gap: 8,
    },
    externalLinksLabel: {
      color: theme.colors.muted,
      fontSize: 11,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    externalLinksBtns: {
      flexDirection: "row",
      gap: 8,
      flexWrap: "wrap",
    },
    externalLinkGlassBtn: {
      minWidth: 158,
      flexGrow: 1,
      height: 58,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.panelSoft,
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 12,
      gap: 10,
    },
    externalLinkGlassBadge: {
      width: 30,
      height: 30,
      borderRadius: 999,
      alignItems: "center",
      justifyContent: "center",
    },
    externalLinkGlassBadgeShikimori: {
      backgroundColor: "#3D74B4",
    },
    externalLinkGlassBadgeAniList: {
      backgroundColor: "#1A8ED7",
    },
    externalLinkGlassBadgeText: {
      color: "#FFFFFF",
      fontSize: 11,
      fontWeight: "800",
      letterSpacing: 0.3,
    },
    externalLinkGlassTextWrap: {
      flex: 1,
      gap: 1,
    },
    externalLinkGlassTitle: {
      color: theme.colors.text,
      fontSize: 14,
      fontWeight: "700",
    },
    externalLinkGlassHint: {
      color: theme.colors.secondaryText,
      fontSize: 11,
      fontWeight: "500",
    },
    externalLinkGlassChevron: {
      color: theme.colors.accent,
      fontSize: 20,
      fontWeight: "700",
    },
    descriptionSection: {
      gap: 6,
    },
    descriptionToggle: {
      color: theme.colors.accent,
      fontSize: 13,
      fontWeight: "600",
      marginTop: 2,
    },
    discoveringCountdown: {
      color: theme.colors.muted,
      fontSize: 13,
      marginTop: 6,
    },
    emptyText: {
      color: theme.colors.muted,
      padding: 14,
    },
    pickerSheetScroll: {
      paddingBottom: 8,
    },
    pickerSheetRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 20,
      paddingVertical: 14,
      gap: 12,
    },
    pickerSheetRowActive: {
      backgroundColor: theme.colors.accentSurface,
    },
    pickerSheetRowText: {
      flex: 1,
      color: theme.colors.text,
      fontSize: 16,
      lineHeight: 22,
    },
    pickerSheetRowTextActive: {
      color: theme.colors.accent,
      fontWeight: "600",
    },
    pickerSheetCheck: {
      color: theme.colors.accent,
      fontSize: 17,
      fontWeight: "700",
    },
    deleteSheetHeader: {
      paddingHorizontal: 20,
      paddingTop: 4,
      paddingBottom: 12,
    },
    deleteSheetTitle: {
      color: theme.colors.text,
      fontSize: 18,
      fontWeight: "700",
    },
    deleteSheetScroll: {
      maxHeight: 400,
    },
    deleteSheetRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 20,
      paddingVertical: 14,
      gap: 12,
    },
    deleteSheetRowBorder: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
    },
    deleteSheetRowText: {
      flex: 1,
      gap: 2,
    },
    deleteSheetEpisodeTitle: {
      color: theme.colors.text,
      fontSize: 15,
      lineHeight: 20,
    },
    deleteSheetEpisodeStatus: {
      color: theme.colors.muted,
      fontSize: 12,
      lineHeight: 16,
    },
  });
