import { Image as ExpoImage } from "expo-image";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, {
  cancelAnimation,
  Extrapolation,
  interpolate,
  Easing as ReanimatedEasing,
  type SharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { AnimePosterCard } from "@/components/AnimePosterCard";
import { ScreenHeader, SectionHeader, StatusCard } from "@/components/ui";
import {
  AnimeCard,
  api,
  getApiErrorMessage,
  getApiLabelText,
  getTitleText,
} from "@/lib/api";
import {
  clearHistory,
  getHistoryAnimeTitle,
  getHistoryEpisodeTitle,
  getHydratedHistory,
  HistoryItem,
} from "@/lib/history";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { supabase } from "@/lib/supabase";

const HERO_BATCH_SIZE = 5;
const HERO_PREFETCH_THRESHOLD = 3;

const clampProgressValue = (value: number) => Math.max(0, Math.min(value, 1));

const getHistoryWatchProgress = (item: HistoryItem) => {
  if (typeof item.progress === "number" && Number.isFinite(item.progress)) {
    return clampProgressValue(item.progress);
  }

  const durationSec = Number(item.durationSec || 0);
  const positionSec = Number(item.positionSec || 0);
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 0;
  if (!Number.isFinite(positionSec) || positionSec <= 0) return 0;

  return clampProgressValue(positionSec / durationSec);
};

function HistoryCard({
  item,
  index,
  historyLength,
  styles,
  onPress,
  language,
  t,
}: {
  item: HistoryItem;
  index: number;
  historyLength: number;
  styles: ReturnType<typeof createStyles>;
  onPress: () => void;
  language: "en" | "ru";
  t: (key: string, params?: Record<string, unknown>) => string;
}) {
  const [imageError, setImageError] = useState(false);
  const progress = getHistoryWatchProgress(item);

  return (
    <Pressable
      key={`${item.animeId}-${item.episodeId}`}
      style={[
        styles.historyCard,
        index !== historyLength - 1 ? styles.historyCardSpaced : null,
      ]}
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress();
      }}
    >
      {item.cover && !imageError ? (
        <ExpoImage
          source={item.cover}
          style={styles.historyCover}
          contentFit="cover"
          onError={() => setImageError(true)}
        />
      ) : (
        <View style={[styles.historyCover, styles.historyCoverFallback]}>
          <Text style={styles.historyCoverFallbackText}>
            {t("library.noCover")}
          </Text>
        </View>
      )}

      <View style={styles.historyBody}>
        <View style={styles.historyTextBlock}>
          <Text style={styles.historyTitle} numberOfLines={2}>
            {getHistoryAnimeTitle(item, language, t("anime.defaultTitle"))}
          </Text>
          <Text style={styles.historyEpisode} numberOfLines={1}>
            {getHistoryEpisodeTitle(
              item,
              (number) => t("anime.episodeFallbackTitle", { number }),
              t("anime.unknownEpisode")
            )}
          </Text>
        </View>

        <View style={styles.historyProgressTrack}>
          <View
            style={[
              styles.historyProgressFill,
              { width: `${Math.round(progress * 100)}%` },
            ]}
          />
        </View>
      </View>
    </Pressable>
  );
}

function HeroCarouselSlide({
  item,
  index,
  scrollX,
  itemSpan,
  cardWidth,
  progressWidth,
  progress,
  heroGradient,
  styles,
  onPress,
  noCoverText,
  dubText,
  formatEpisodeLabel,
  language,
}: {
  item: AnimeCard;
  index: number;
  scrollX: SharedValue<number>;
  itemSpan: number;
  cardWidth: number;
  progressWidth: number;
  progress: SharedValue<number>;
  heroGradient: readonly [string, string, string];
  styles: ReturnType<typeof createStyles>;
  onPress: () => void;
  noCoverText: string;
  dubText: string;
  formatEpisodeLabel: (number: string) => string;
  language: "en" | "ru";
}) {
  const typeText = getApiLabelText(item.type, language);
  const statusText = getApiLabelText(item.status, language);
  const [imageError, setImageError] = useState(false);
  const [fallbackCover, setFallbackCover] = useState<string | null>(null);
  const [fallbackError, setFallbackError] = useState(false);

  // Fetch anilist cover when primary cover is missing or failed to load
  useEffect(() => {
    if (fallbackCover) return; // already have fallback
    if (!imageError && item.cover) return; // primary cover exists and hasn't failed yet
    let cancelled = false;
    api.anime(item.id).then((details) => {
      if (cancelled) return;
      const anilistId = details.anilistHref
        ? String(details.anilistHref).split('/').pop() || null
        : null;
      if (anilistId) {
        // Query AniList GraphQL directly for the cover image
        fetch('https://graphql.anilist.co', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: `query($id:Int){Media(id:$id){coverImage{large}}}`,
            variables: { id: Number(anilistId) },
          }),
        })
          .then((r) => r.json())
          .then((data: { data?: { Media?: { coverImage?: { large?: string } } } }) => {
            const url = data?.data?.Media?.coverImage?.large;
            if (url && !cancelled) setFallbackCover(url);
          })
          .catch(() => {});
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [item.id, item.cover, imageError, fallbackCover]);

  const coverSource = imageError
    ? (fallbackError ? null : fallbackCover)
    : (item.cover || fallbackCover);
  
  const motionStyle = useAnimatedStyle(() => {
    const center = index * itemSpan;
    const translateX = interpolate(
      scrollX.value,
      [center - itemSpan, center, center + itemSpan],
      [-18, 0, 18],
      Extrapolation.CLAMP,
    );
    const scale = interpolate(
      scrollX.value,
      [center - itemSpan, center, center + itemSpan],
      [0.96, 1, 0.96],
      Extrapolation.CLAMP,
    );
    const opacity = interpolate(
      scrollX.value,
      [center - itemSpan, center, center + itemSpan],
      [0.8, 1, 0.8],
      Extrapolation.CLAMP,
    );

    return {
      transform: [{ translateX }, { scale }],
      opacity,
    };
  }, [index, itemSpan]);

  const progressStyle = useAnimatedStyle(
    () => ({
      width: progressWidth * progress.value,
    }),
    [progressWidth],
  );

  return (
    <Animated.View
      style={[styles.heroCardWrap, { width: cardWidth }, motionStyle]}
    >
      <Pressable style={styles.heroCard} onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress();
      }}>
        {coverSource && !(imageError && fallbackError) ? (
          <ExpoImage
            source={coverSource}
            style={styles.heroImage}
            contentFit="cover"
            contentPosition="center"
            transition={120}
            recyclingKey={item.id}
            onError={() => {
              if (imageError) {
                // Fallback also failed
                setFallbackError(true);
              } else {
                // Primary failed — try fallback
                setImageError(true);
              }
            }}
          />
        ) : (
          <View style={[styles.heroImage, styles.heroFallback]}>
            <Text style={styles.heroFallbackText}>{noCoverText}</Text>
          </View>
        )}

        <LinearGradient colors={heroGradient} style={StyleSheet.absoluteFill} />

        <View style={styles.heroContent}>
          <View style={styles.heroBottom}>
            <View style={styles.heroInfoRow}>
              {typeText ? (
                <Text style={styles.heroInlineMeta}>{typeText}</Text>
              ) : null}
              {statusText ? (
                <Text style={styles.heroInlineMeta}>• {statusText}</Text>
              ) : null}
            </View>

            <Text numberOfLines={2} style={styles.heroTitle}>
              {getTitleText(item.title, language)}
            </Text>

            {item.synopsis ? (
              <Text style={styles.heroSynopsis} numberOfLines={3}>
                {item.synopsis}
              </Text>
            ) : null}

            <View style={styles.heroBadgesRow}>
              {item.episode ? (
                <View style={[styles.heroBadge, styles.heroEpisodeBadge]}>
                  <Text
                    style={[styles.heroBadgeText, styles.heroEpisodeBadgeText]}
                  >
                    {formatEpisodeLabel(item.episode)}
                  </Text>
                </View>
              ) : null}
              {item.dub ? (
                <View style={[styles.heroBadge, styles.heroDubBadge]}>
                  <Text style={[styles.heroBadgeText, styles.heroDubBadgeText]}>
                    {dubText}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>

        <View style={styles.heroProgressOverlay}>
          <View style={[styles.heroProgressTrack, { width: progressWidth }]}>
            <Animated.View style={[styles.heroProgressFill, progressStyle]} />
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

export default function HomeScreen() {
  const { t, language } = useI18n();
  const theme = useTheme();
  const { width: viewportWidth, height: viewportHeight } =
    useWindowDimensions();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [highlight, setHighlight] = useState<AnimeCard[]>([]);
  const [hero, setHero] = useState<AnimeCard[]>([]);
  const [heroItems, setHeroItems] = useState<AnimeCard[]>([]);
  const [latest, setLatest] = useState<AnimeCard[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userInitials, setUserInitials] = useState<string | null>(null);
  const [currentHeroIndex, setCurrentHeroIndex] = useState(0);
  const [heroAnimationKey, setHeroAnimationKey] = useState(0);
  const heroIsDraggingRef = useRef(false);
  const heroSettledIndexRef = useRef(0);
  const currentHeroIndexRef = useRef(0);
  const heroScrollRef = useRef<FlatList<AnimeCard> | null>(null);
  const heroNextCursorRef = useRef(0);
  const heroItemsLengthRef = useRef(0);
  const heroPoolLengthRef = useRef(0);
  const heroAdvanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const heroAutoScrollFallbackRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const heroAutoAdvanceMs = 5500;
  const heroProgress = useSharedValue(0);
  const heroScrollX = useSharedValue(0);

  const heroHeight = useMemo(
    () => Math.max(420, Math.min(Math.round(viewportHeight * 0.62), 620)),
    [viewportHeight],
  );
  const heroSlideWidth = useMemo(() => viewportWidth, [viewportWidth]);
  const heroCardWidth = useMemo(
    () => Math.max(288, Math.min(viewportWidth - 32, 460)),
    [viewportWidth],
  );
  const heroCardGap = useMemo(
    () => Math.max(36, Math.round(viewportWidth * 0.08)),
    [viewportWidth],
  );
  const heroItemSpan = heroSlideWidth + heroCardGap;
  const heroProgressWidth = useMemo(
    () => Math.max(96, Math.min(heroCardWidth * 0.48, 180)),
    [heroCardWidth],
  );
  const latestTileWidth = useMemo(
    () => Math.floor((viewportWidth - 16 * 2 - 12) / 2),
    [viewportWidth],
  );

  const loadHistory = useCallback(async () => {
    const items = await getHydratedHistory();
    setHistory(items.slice(0, 8));
  }, []);

  const loadHome = useCallback(
    async (asRefresh = false) => {
      try {
        setError(null);
        if (asRefresh) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }

        const data = await api.home();
        setHero(data.hero || []);
        setHighlight(data.highlight || []);
        setLatest(data.latest || []);
      } catch (err) {
        setError(getApiErrorMessage(err, language, t("home.error")));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [language, t],
  );

  useEffect(() => {
    loadHome();
    loadHistory();
  }, [loadHistory, loadHome]);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      const email = data.session?.user?.email || "";
      if (email) {
        const parts = email.split("@")[0].split(/[._-]/);
        const initials = parts.length >= 2
          ? (parts[0][0] + parts[1][0]).toUpperCase()
          : email.slice(0, 2).toUpperCase();
        setUserInitials(initials);
      }
    }).catch(() => {});
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadHistory();
    }, [loadHistory]),
  );

  const openAnime = useCallback((id: string, episodeId?: string) => {
    router.push({
      pathname: "/anime/[id]",
      params: episodeId ? { id, episodeId } : { id },
    });
  }, []);

  const openFromHistory = useCallback((item: HistoryItem) => {
    router.push({
      pathname: "/anime/[id]",
      params: {
        id: item.animeId,
        episodeId: item.episodeId,
        historyTeamSlug: item.teamSlug || "",
        historyQuality: item.quality || "",
        historyPositionSec: String(Number(item.positionSec || 0)),
        scrollToPlayer: "1",
      },
    });
  }, []);

  const handleClearHistory = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    Alert.alert(t("library.clearHistoryTitle"), t("library.clearHistoryBody"), [
      { text: t("library.cancel"), style: "cancel" },
      {
        text: t("library.clear"),
        style: "destructive",
        onPress: () => {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
          void clearHistory().then(() => {
            setHistory([]);
          });
        },
      },
    ]);
  }, [t]);

  const heroPool = useMemo(() => {
    return hero.length > 0 ? hero : highlight.length > 0 ? highlight : latest;
  }, [hero, highlight, latest]);

  heroItemsLengthRef.current = heroItems.length;
  heroPoolLengthRef.current = heroPool.length;

  const clearHeroTimers = useCallback(() => {
    if (heroAdvanceTimerRef.current) {
      clearTimeout(heroAdvanceTimerRef.current);
      heroAdvanceTimerRef.current = null;
    }
    if (heroAutoScrollFallbackRef.current) {
      clearTimeout(heroAutoScrollFallbackRef.current);
      heroAutoScrollFallbackRef.current = null;
    }
  }, []);

  const commitHeroIndex = useCallback((index: number) => {
    const maxIndex = Math.max(heroItemsLengthRef.current - 1, 0);
    const next = Math.max(0, Math.min(index, maxIndex));

    currentHeroIndexRef.current = next;
    heroSettledIndexRef.current = next;
    setCurrentHeroIndex(next);
  }, []);

  const scrollToHeroIndex = useCallback(
    (index: number, animated = true) => {
      const maxIndex = Math.max(heroItemsLengthRef.current - 1, 0);
      const next = Math.max(0, Math.min(index, maxIndex));

      heroScrollRef.current?.scrollToIndex({ index: next, animated });
      if (!animated) {
        commitHeroIndex(next);
        return;
      }

      if (heroAutoScrollFallbackRef.current) {
        clearTimeout(heroAutoScrollFallbackRef.current);
      }
      heroAutoScrollFallbackRef.current = setTimeout(() => {
        heroAutoScrollFallbackRef.current = null;
        if (heroIsDraggingRef.current) return;
        heroScrollX.value = next * heroItemSpan;
        commitHeroIndex(next);
      }, 420);
    },
    [commitHeroIndex, heroItemSpan, heroScrollX],
  );

  const latestItems = useMemo(() => {
    return latest;
  }, [latest]);
  const latestRows = useMemo(() => {
    const rows: AnimeCard[][] = [];
    for (let index = 0; index < latestItems.length; index += 2) {
      rows.push(latestItems.slice(index, index + 2));
    }
    return rows;
  }, [latestItems]);

  useEffect(() => {
    currentHeroIndexRef.current = currentHeroIndex;
    heroSettledIndexRef.current = currentHeroIndex;

    if (currentHeroIndex >= heroItems.length) {
      commitHeroIndex(0);
      heroIsDraggingRef.current = false;
    }
  }, [commitHeroIndex, currentHeroIndex, heroItems.length]);

  useEffect(() => {
    clearHeroTimers();
    cancelAnimation(heroProgress);
    heroProgress.value = 0;

    if (heroPool.length === 0) {
      setHeroItems([]);
      commitHeroIndex(0);
      heroNextCursorRef.current = 0;
      return;
    }

    const initialCount = Math.min(heroPool.length, HERO_BATCH_SIZE);
    setHeroItems(heroPool.slice(0, initialCount));
    commitHeroIndex(0);
    heroIsDraggingRef.current = false;
    heroNextCursorRef.current = initialCount;
    heroScrollX.value = 0;

    const frame = requestAnimationFrame(() => {
      heroScrollRef.current?.scrollToIndex({ index: 0, animated: false });
      setTimeout(() => {
        setHeroAnimationKey((prev) => prev + 1);
      }, 100);
    });

    return () => {
      cancelAnimationFrame(frame);
      clearHeroTimers();
      cancelAnimation(heroProgress);
      heroProgress.value = 0;
    };
  }, [clearHeroTimers, commitHeroIndex, heroPool, heroProgress, heroScrollX]);

  useEffect(() => {
    if (heroPool.length <= heroItems.length) {
      return;
    }

    if (heroItems.length - currentHeroIndex - 1 > HERO_PREFETCH_THRESHOLD) {
      return;
    }

    const nextCursor = heroNextCursorRef.current;
    const nextCount = Math.min(HERO_BATCH_SIZE, heroPool.length - nextCursor);
    if (nextCount <= 0) {
      return;
    }

    heroNextCursorRef.current = nextCursor + nextCount;
    setHeroItems((prev) => [
      ...prev,
      ...heroPool.slice(nextCursor, nextCursor + nextCount),
    ]);
  }, [currentHeroIndex, heroItems.length, heroPool]);

  const heroCanAutoAdvance = heroPool.length > 1 && heroItems.length > 1;

  useEffect(() => {
    clearHeroTimers();
    cancelAnimation(heroProgress);
    heroProgress.value = 0;

    if (!heroCanAutoAdvance || heroIsDraggingRef.current) {
      return;
    }

    heroProgress.value = withTiming(1, {
      duration: heroAutoAdvanceMs,
      easing: ReanimatedEasing.linear,
    });

    heroAdvanceTimerRef.current = setTimeout(() => {
      heroAdvanceTimerRef.current = null;
      if (heroIsDraggingRef.current) return;

      const current = currentHeroIndexRef.current;
      const lastLoadedIndex = Math.max(heroItemsLengthRef.current - 1, 0);
      const next = current < lastLoadedIndex ? current + 1 : 0;

      cancelAnimation(heroProgress);
      heroProgress.value = 0;
      scrollToHeroIndex(next, true);
    }, heroAutoAdvanceMs);

    return () => {
      clearHeroTimers();
      cancelAnimation(heroProgress);
      heroProgress.value = 0;
    };
  }, [
    clearHeroTimers,
    currentHeroIndex,
    heroCanAutoAdvance,
    heroProgress,
    scrollToHeroIndex,
    heroAutoAdvanceMs,
    heroAnimationKey,
  ]);

  const heroScrollHandler = useAnimatedScrollHandler(
    {
      onScroll: (event) => {
        heroScrollX.value = event.contentOffset.x;
      },
    },
    [],
  );

  const refreshControl = useMemo(
    () => (
      <RefreshControl
        refreshing={refreshing}
        onRefresh={() => loadHome(true)}
        tintColor="transparent"
        colors={["transparent"]}
        progressBackgroundColor="transparent"
      />
    ),
    [loadHome, refreshing],
  );

  const heroGradient = useMemo(
    () =>
      [
        theme.colors.heroGradientTop,
        theme.colors.heroGradientMiddle,
        theme.colors.heroGradientBottom,
      ] as const,
    [
      theme.colors.heroGradientTop,
      theme.colors.heroGradientMiddle,
      theme.colors.heroGradientBottom,
    ],
  );
  return (
    <SafeAreaView
      style={styles.safeArea}
      edges={
        Platform.OS === "android" ? ["top", "left", "right"] : ["left", "right"]
      }
    >
      {refreshing && !loading ? (
        <View pointerEvents="none" style={styles.refreshingOverlay}>
          <ActivityIndicator color={theme.colors.indicator} size="large" />
        </View>
      ) : null}

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.container}
        refreshControl={refreshControl}
      >
        <View style={styles.headerPad}>
          <ScreenHeader
            title={t("tabs.home")}
            accountButton={{
              onPress: () => router.push("/account"),
              size: "large",
              initials: userInitials,
            }}
          />
        </View>

        {!loading && !error && heroItems.length > 0 ? (
          <View style={styles.heroSection}>
            <View style={[styles.heroViewport, { width: heroSlideWidth }]}>
              <Animated.FlatList
                ref={heroScrollRef}
                data={heroItems}
                keyExtractor={(item, index) => `${item.id}-${index}`}
                horizontal
                showsHorizontalScrollIndicator={false}
                snapToInterval={heroItemSpan}
                decelerationRate="fast"
                disableIntervalMomentum
                bounces={false}
                overScrollMode="never"
                initialNumToRender={7}
                maxToRenderPerBatch={6}
                windowSize={5}
                removeClippedSubviews
                contentContainerStyle={styles.heroListContent}
                getItemLayout={(_, index) => ({
                  length: heroItemSpan,
                  offset: heroItemSpan * index,
                  index,
                })}
                onScrollBeginDrag={() => {
                  heroIsDraggingRef.current = true;
                  void Haptics.selectionAsync().catch(() => {});
                  clearHeroTimers();
                  cancelAnimation(heroProgress);
                  heroProgress.value = 0;
                }}
                onScroll={heroScrollHandler}
                scrollEventThrottle={16}
                onMomentumScrollEnd={(event) => {
                  const rawIndex = Math.max(
                    0,
                    Math.round(
                      event.nativeEvent.contentOffset.x / heroItemSpan,
                    ),
                  );
                  const next = Math.max(
                    0,
                    Math.min(rawIndex, Math.max(heroItems.length - 1, 0)),
                  );
                  heroIsDraggingRef.current = false;
                  if (heroAutoScrollFallbackRef.current) {
                    clearTimeout(heroAutoScrollFallbackRef.current);
                    heroAutoScrollFallbackRef.current = null;
                  }
                  heroScrollX.value = next * heroItemSpan;
                  commitHeroIndex(next);
                }}
                renderItem={({ item, index }) => (
                  <View
                    key={`${item.id}-${index}`}
                    style={[
                      styles.heroItemWrap,
                      {
                        width: heroSlideWidth,
                        height: heroHeight,
                        marginRight:
                          index === heroItems.length - 1 ? 0 : heroCardGap,
                      },
                    ]}
                  >
                    <HeroCarouselSlide
                      item={item}
                      index={index}
                      scrollX={heroScrollX}
                      itemSpan={heroItemSpan}
                      cardWidth={heroCardWidth}
                      progressWidth={heroProgressWidth}
                      progress={heroProgress}
                      heroGradient={heroGradient}
                      styles={styles}
                      onPress={() => openAnime(item.id)}
                      noCoverText={t("anime.noCover")}
                      dubText={t("anime.dub")}
                      formatEpisodeLabel={(number) =>
                        t("anime.episodeLabel", { number })
                      }
                      language={language}
                    />
                  </View>
                )}
              />
            </View>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.centerBlock}>
            <ActivityIndicator color={theme.colors.indicator} size="large" />
            <Text style={styles.loadingText}>{t("home.loading")}</Text>
          </View>
        ) : null}

        {!loading && error ? (
          <View style={styles.statePad}>
            <StatusCard
              title={t("home.error")}
              message={error}
              actionLabel={t("home.retry")}
              onAction={() => loadHome()}
            />
          </View>
        ) : null}

        {!loading && !error && history.length > 0 ? (
          <View style={styles.sectionBlock}>
            <View style={[styles.sectionHeaderPad, styles.sectionHeaderRow]}>
              <View style={styles.sectionHeaderMain}>
                <SectionHeader title={t("tabs.continueWatching")} />
              </View>
              <Pressable
                style={styles.historyClearAction}
                onPress={handleClearHistory}
                hitSlop={8}
              >
                <Ionicons name="trash-outline" size={20} color={theme.colors.accent} />
              </Pressable>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.historyRail}
            >
              {history.map((item, index) => (
                <HistoryCard
                  key={`${item.animeId}-${item.episodeId}`}
                  item={item}
                  index={index}
                  historyLength={history.length}
                  styles={styles}
                  onPress={() => openFromHistory(item)}
                  language={language}
                  t={t}
                />
              ))}
            </ScrollView>
          </View>
        ) : null}

        {!loading && !error && latestItems.length > 0 ? (
          <View style={styles.sectionBlock}>
            <View style={styles.sectionHeaderPad}>
              <SectionHeader
                title={t("home.latest")}
              />
            </View>

            <View style={styles.feedStack}>
              {latestRows.map((row, rowIndex) => (
                <View
                  key={`latest-row-${rowIndex}`}
                  style={styles.latestGridRow}
                >
                  {row.map((item) => (
                    <View
                      key={`${item.id}-${item.episode ?? "ep"}`}
                      style={[
                        styles.latestGridItem,
                        { width: latestTileWidth },
                      ]}
                    >
                      <AnimePosterCard
                        item={item}
                        variant="grid"
                        onPress={openAnime}
                      />
                    </View>
                  ))}
                  {row.length === 1 ? (
                    <View
                      style={[
                        styles.latestGridItem,
                        { width: latestTileWidth },
                      ]}
                    />
                  ) : null}
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>
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
      paddingBottom: 32,
      backgroundColor: theme.colors.background,
    },
    headerPad: {
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 14,
    },
    refreshingOverlay: {
      position: "absolute",
      top: Platform.OS === "ios" ? 56 : 12,
      left: 0,
      right: 0,
      alignItems: "center",
      justifyContent: "center",
      zIndex: 50,
      elevation: 50,
    },
    heroSection: {
      marginTop: 2,
      alignItems: "stretch",
    },
    heroViewport: {
      overflow: "hidden",
    },
    heroListContent: {
      paddingHorizontal: 0,
    },
    heroItemWrap: {
      overflow: "visible",
      alignItems: "center",
    },
    heroCardWrap: {
      width: "100%",
      height: "100%",
    },
    heroCard: {
      flex: 1,
      borderRadius: 24,
      overflow: "hidden",
      backgroundColor: theme.colors.backgroundAlt,
      justifyContent: "flex-end",
    },
    heroImage: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      width: "100%",
      height: "100%",
    },
    heroFallback: {
      justifyContent: "center",
      alignItems: "center",
      backgroundColor: theme.colors.panelSoft,
    },
    heroFallbackText: {
      color: theme.colors.text,
      fontFamily: theme.typography.bodyMedium,
      letterSpacing: 1.2,
      textTransform: "uppercase",
    },
    heroContent: {
      flex: 1,
      justifyContent: "flex-end",
      paddingHorizontal: 22,
      paddingTop: 20,
      paddingBottom: 36,
    },
    heroBottom: {
      gap: 10,
    },
    heroInfoRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 4,
      alignItems: "center",
    },
    heroInlineMeta: {
      color: theme.colors.heroMetaText,
      fontFamily: theme.typography.body,
      fontSize: 14,
      lineHeight: 20,
    },
    heroTitle: {
      color: theme.colors.heroTitleText,
      fontWeight: "900",
      fontSize: 32,
      lineHeight: 38,
      maxWidth: "94%",
    },
    heroSynopsis: {
      color: theme.colors.heroSynopsisText,
      fontSize: 15,
      lineHeight: 22,
      maxWidth: "94%",
    },
    heroBadgesRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingTop: 4,
      flexWrap: "wrap",
    },
    heroBadge: {
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 7,
      justifyContent: "center",
      alignItems: "center",
    },
    heroEpisodeBadge: {
      backgroundColor: theme.colors.accent,
    },
    heroDubBadge: {
      backgroundColor: theme.colors.heroDubBadgeBg,
      borderWidth: 1,
      borderColor: theme.colors.heroDubBadgeBorder,
    },
    heroBadgeText: {
      fontWeight: "800",
      fontSize: 12,
      letterSpacing: 0.3,
    },
    heroEpisodeBadgeText: {
      color: theme.colors.onAccent,
    },
    heroDubBadgeText: {
      color: theme.colors.heroDubBadgeText,
    },
    heroProgressOverlay: {
      position: "absolute",
      bottom: 16,
      alignSelf: "center",
      alignItems: "center",
    },
    heroProgressTrack: {
      height: 5,
      borderRadius: 999,
      overflow: "hidden",
      backgroundColor: theme.colors.heroProgressTrack,
    },
    heroProgressFill: {
      height: "100%",
      borderRadius: 999,
      backgroundColor: theme.colors.accent,
    },
    sectionBlock: {
      marginTop: 24,
    },
    sectionHeaderPad: {
      paddingHorizontal: 16,
      marginBottom: 12,
    },
    sectionHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    sectionHeaderMain: {
      flex: 1,
      minWidth: 0,
    },
    historyClearAction: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    historyClearActionText: {
      color: theme.colors.accentSoft,
      fontSize: 12,
      fontWeight: "700",
    },
    historyRail: {
      paddingHorizontal: 16,
    },
    historyCardSpaced: {
      marginRight: 16,
    },
    recommendationRail: {
      paddingHorizontal: 16,
    },
    historyCard: {
      width: 360,
      borderRadius: 16,
      backgroundColor: theme.colors.panel,
      borderWidth: 1,
      borderColor: theme.colors.border,
      flexDirection: "row",
      gap: 12,
      alignItems: "stretch",
      overflow: "hidden",
    },
    historyCover: {
      width: 70,
      alignSelf: "stretch",
      backgroundColor: theme.colors.panelSoft,
      borderRadius: 12,
    },
    historyCoverFallback: {
      justifyContent: "center",
      alignItems: "center",
    },
    historyCoverFallbackText: {
      color: theme.colors.muted,
      fontFamily: theme.typography.body,
      fontSize: 9,
      textAlign: "center",
      paddingHorizontal: 4,
    },
    historyBody: {
      flex: 1,
      justifyContent: "space-between",
      gap: 10,
      paddingVertical: 9,
      paddingRight: 9,
      minWidth: 0,
    },
    historyTextBlock: {
      gap: 8,
      minWidth: 0,
    },
    historyTitle: {
      color: theme.colors.text,
      fontWeight: "800",
      fontSize: 16,
      lineHeight: 21,
    },
    historyEpisode: {
      color: theme.colors.muted,
      fontSize: 14,
      lineHeight: 20,
    },
    historyProgressTrack: {
      height: 6,
      borderRadius: 999,
      backgroundColor: theme.colors.panelSoft,
      overflow: "hidden",
    },
    historyProgressFill: {
      height: "100%",
      borderRadius: 999,
      backgroundColor: theme.colors.accent,
      minWidth: 0,
    },
    feedStack: {
      paddingHorizontal: 16,
    },
    latestGridRow: {
      flexDirection: "row",
      gap: 12,
      marginBottom: 12,
      alignItems: "stretch",
    },
    latestGridItem: {
      minWidth: 0,
    },
    centerBlock: {
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 40,
      paddingHorizontal: 16,
    },
    loadingText: {
      color: theme.colors.muted,
      marginTop: 10,
      fontSize: 14,
    },
    statePad: {
      paddingHorizontal: 16,
      marginTop: 12,
    },
  });
