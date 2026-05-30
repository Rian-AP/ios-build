import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Image as ExpoImage } from "expo-image";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Host, Menu, Button as SwiftButton } from "@expo/ui/swift-ui";
import { buttonStyle, foregroundColor } from "@expo/ui/swift-ui/modifiers";

import {
  api,
  EpisodeListItem,
  EpisodePlayer,
  EpisodePlaybackResponse,
  getApiLabelText,
  getTitleText,
} from "@/lib/api";
import {
  buildDownloadId,
  DownloadItem,
  getDownloads,
  subscribeDownloads,
} from "@/lib/downloads";
import { useI18n } from "@/lib/i18n";
import {
  enqueueEpisodeDownload,
  resolveOfflinePlaylistUri,
} from "@/lib/offlineDownloads";
import { useTheme } from "@/lib/theme";

const USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

const sortQualities = (qualities: string[]) =>
  [...qualities].sort((a, b) => Number(b) - Number(a));

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

const displayEpisodeLabel = (episode: EpisodeListItem, fallback: string) => {
  const title = String(episode.title || "").trim() || fallback;
  return `#${episode.episodeNumber} • ${title}`;
};

const toPercentLabel = (value: number) =>
  `${Math.round(Math.max(0, Math.min(value, 1)) * 100)}%`;

export default function DownloadModal() {
  const router = useRouter();
  const { t, language } = useI18n();
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const params = useLocalSearchParams<{
    animeId?: string;
    episodeId?: string;
    teamSlug?: string;
    quality?: string;
  }>();

  const animeId = String(params.animeId || "").trim();
  const initialEpisodeId = String(params.episodeId || "").trim();
  const initialTeamSlug = String(params.teamSlug || "").trim() || null;
  const initialQuality = String(params.quality || "").trim() || null;

  // State
  const [allEpisodes, setAllEpisodes] = useState<EpisodeListItem[]>([]);
  const [players, setPlayers] = useState<EpisodePlayer[]>([]);
  const [qualities, setQualities] = useState<string[]>([]);
  const [selectedTeamSlug, setSelectedTeamSlug] = useState<string | null>(initialTeamSlug);
  const [selectedQuality, setSelectedQuality] = useState<string | null>(initialQuality);
  const [selectedEpisodeIds, setSelectedEpisodeIds] = useState<string[]>(
    initialEpisodeId ? [initialEpisodeId] : [],
  );
  const [metaLoading, setMetaLoading] = useState(true);
  const [queueing, setQueueing] = useState(false);
  const [downloadItems, setDownloadItems] = useState<DownloadItem[]>([]);
  const [animeCover, setAnimeCover] = useState<string | null>(null);
  const [animeTitle, setAnimeTitle] = useState<string>("");
  const requestIdRef = useRef(0);

  // Subscribe to download updates
  useEffect(() => {
    let cancelled = false;
    void getDownloads().then((items) => {
      if (!cancelled) setDownloadItems(items);
    });
    const unsub = subscribeDownloads((next) => {
      if (!cancelled) setDownloadItems(next);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  // Load episodes + meta
  useEffect(() => {
    if (!animeId) return;
    let cancelled = false;
    setMetaLoading(true);

    void (async () => {
      try {
        // Load anime details + episodes
        const page = await api.animePage(animeId);
        if (cancelled) return;

        const cover = page.details.cover || null;
        const title = getTitleText(page.details.title, language) || animeId;
        setAnimeCover(cover);
        setAnimeTitle(title);
        setAllEpisodes(page.episodes);

        // Load playback for anchor episode
        const anchorId = initialEpisodeId || page.episodes[0]?.id;
        if (!anchorId) {
          setMetaLoading(false);
          return;
        }

        if (!selectedEpisodeIds.length && anchorId) {
          setSelectedEpisodeIds([anchorId]);
        }

        const reqId = ++requestIdRef.current;
        const playback = await api.episode(anchorId);
        if (cancelled || reqId !== requestIdRef.current) return;

        const playerList = playback.players || [];
        const preferred =
          playerList.find((p) => p.teamSlug === initialTeamSlug) ||
          playerList[0] ||
          null;

        const qualityList = sortQualities(
          Object.keys(preferred?.qualityLinks || {}),
        );
        const bestQuality =
          (initialQuality && preferred?.qualityLinks[initialQuality]
            ? initialQuality
            : qualityList[0]) || null;

        setPlayers(playerList);
        setSelectedTeamSlug(preferred?.teamSlug || null);
        setQualities(qualityList);
        setSelectedQuality(bestQuality);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setMetaLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animeId]);

  // Reload meta when team changes
  const handleSelectVoice = useCallback(
    async (teamSlug: string | null) => {
      void Haptics.selectionAsync().catch(() => {});
      setSelectedTeamSlug(teamSlug);
      const anchorId = selectedEpisodeIds[0];
      if (!anchorId) return;

      setMetaLoading(true);
      const reqId = ++requestIdRef.current;
      try {
        const playback = await api.episode(anchorId);
        if (reqId !== requestIdRef.current) return;
        const preferred =
          playback.players.find((p) => p.teamSlug === teamSlug) ||
          playback.players[0] ||
          null;
        const qualityList = sortQualities(
          Object.keys(preferred?.qualityLinks || {}),
        );
        setPlayers(playback.players);
        setQualities(qualityList);
        setSelectedQuality(qualityList[0] || null);
      } catch {
        // ignore
      } finally {
        if (reqId === requestIdRef.current) setMetaLoading(false);
      }
    },
    [selectedEpisodeIds],
  );

  const handleSelectQuality = useCallback((q: string) => {
    void Haptics.selectionAsync().catch(() => {});
    setSelectedQuality(q);
  }, []);

  const toggleEpisode = useCallback((id: string) => {
    setSelectedEpisodeIds((prev) => {
      if (prev.includes(id)) {
        const next = prev.filter((x) => x !== id);
        return next.length ? next : prev;
      }
      return [...prev, id];
    });
  }, []);

  const getEpisodeState = useCallback(
    (episodeId: string) => {
      const id = buildDownloadId(episodeId, selectedTeamSlug, selectedQuality);
      const item = downloadItems.find((x) => x.id === id);
      if (!item) return null;
      const progress =
        item.status === "completed"
          ? 1
          : Math.max(0, Math.min(Number(item.progress || 0), 1));
      return { status: item.status, progress };
    },
    [downloadItems, selectedQuality, selectedTeamSlug],
  );

  const selectedSet = useMemo(
    () => new Set(selectedEpisodeIds),
    [selectedEpisodeIds],
  );

  const voiceLabel = useMemo(() => {
    const p = players.find((x) => x.teamSlug === selectedTeamSlug);
    return p
      ? displayPlayerLabel(p, language, t("anime.unknownTeam"), t("anime.unknownTranslation"))
      : t("anime.noPlayers");
  }, [language, players, selectedTeamSlug, t]);

  const qualityLabel = selectedQuality ? `${selectedQuality}p` : t("anime.noQualities");

  const selectedCountLabel = useMemo(() => {
    const n = selectedEpisodeIds.length;
    return language === "ru" ? `Выбрано: ${n}` : `Selected: ${n}`;
  }, [language, selectedEpisodeIds.length]);

  const canQueue =
    !metaLoading &&
    !queueing &&
    selectedEpisodeIds.length > 0 &&
    Boolean(selectedTeamSlug !== undefined);

  const handleQueue = useCallback(() => {
    if (!canQueue) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setQueueing(true);

    void (async () => {
      let queued = 0;
      let skipped = 0;

      for (const episodeId of selectedEpisodeIds) {
        const episode = allEpisodes.find((e) => e.id === episodeId);
        if (!episode) { skipped++; continue; }

        try {
          const playback = await api.episode(episodeId);
          const player =
            playback.players.find((p) => p.teamSlug === selectedTeamSlug) ||
            playback.players[0];
          if (!player) { skipped++; continue; }

          const quality = selectedQuality && player.qualityLinks[selectedQuality]
            ? selectedQuality
            : sortQualities(Object.keys(player.qualityLinks))[0] || null;

          const streamUrl = quality
            ? player.qualityLinks[quality]
            : player.srcResolved;
          if (!streamUrl) { skipped++; continue; }

          const existing = downloadItems.find(
            (x) => x.id === buildDownloadId(episodeId, player.teamSlug || null, quality),
          );
          if (
            existing?.status === "queued" ||
            existing?.status === "downloading"
          ) {
            skipped++;
            continue;
          }

          await enqueueEpisodeDownload({
            animeId,
            animeTitle,
            episodeId,
            episodeTitle: episode.title,
            episodeNumber: episode.episodeNumber,
            teamSlug: player.teamSlug || null,
            teamName: player.teamName || null,
            translationType: player.translationType || null,
            quality,
            streamUrl,
            headers: { Accept: "*/*", "User-Agent": USER_AGENT },
          });
          queued++;
        } catch {
          skipped++;
        }
      }

      setQueueing(false);

      if (queued > 0) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        setSelectedEpisodeIds([]);
      } else {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        Alert.alert(
          t("anime.downloadEpisode"),
          language === "ru"
            ? `Добавлено: ${queued}, пропущено: ${skipped}`
            : `Added: ${queued}, skipped: ${skipped}`,
        );
      }
    })();
  }, [
    allEpisodes,
    animeId,
    animeTitle,
    canQueue,
    downloadItems,
    language,
    selectedEpisodeIds,
    selectedQuality,
    selectedTeamSlug,
    t,
  ]);

  return (
    <>
      <Stack.Screen
        options={{
          title: t("anime.downloadEpisode"),
          presentation: "modal",
          headerRight: () => (
            <Pressable onPress={() => router.back()} hitSlop={8} style={{ padding: 4 }}>
              <Ionicons name="close" size={22} color={theme.colors.accent} />
            </Pressable>
          ),
        }}
      />

      <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
        {/* Header with anime info */}
        <View style={styles.header}>
          {animeCover ? (
            <ExpoImage
              source={animeCover}
              style={styles.cover}
              contentFit="cover"
            />
          ) : null}
          <View style={styles.headerText}>
            <Text style={styles.headerTitle} numberOfLines={2}>
              {animeTitle}
            </Text>
            <Text style={styles.headerSub}>{selectedCountLabel}</Text>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Voice selector */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t("anime.selectVoice")}</Text>
            {metaLoading ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color={theme.colors.accent} />
              </View>
            ) : players.length === 0 ? (
              <Text style={styles.hint}>{t("anime.noPlayers")}</Text>
            ) : Platform.OS === "ios" ? (
              <View style={styles.selectorCard}>
                <Host style={StyleSheet.absoluteFill}>
                  <Menu
                    label={voiceLabel}
                    modifiers={[buttonStyle("plain"), foregroundColor(theme.colors.text)]}
                  >
                    {players.map((p) => (
                      <SwiftButton
                        key={p.id}
                        label={displayPlayerLabel(p, language, t("anime.unknownTeam"), t("anime.unknownTranslation"))}
                        systemImage={p.teamSlug === selectedTeamSlug ? "checkmark.circle.fill" : undefined}
                        onPress={() => void handleSelectVoice(p.teamSlug || null)}
                      />
                    ))}
                  </Menu>
                </Host>
                <View style={styles.selectorCardContent} pointerEvents="none">
                  <Text style={styles.selectorCardValue} numberOfLines={1}>
                    {voiceLabel}
                  </Text>
                  <Ionicons name="chevron-down" size={14} color={theme.colors.muted} />
                </View>
              </View>
            ) : (
              <Pressable
                style={styles.selectorCard}
                onPress={() => {
                  // Android: show action sheet or bottom sheet
                }}
              >
                <Text style={styles.selectorCardValue} numberOfLines={1}>
                  {voiceLabel}
                </Text>
                <Ionicons name="chevron-down" size={14} color={theme.colors.muted} />
              </Pressable>
            )}
          </View>

          {/* Quality selector */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t("anime.selectQuality")}</Text>
            {qualities.length === 0 ? (
              <Text style={styles.hint}>{t("anime.noQualities")}</Text>
            ) : Platform.OS === "ios" ? (
              <View style={styles.selectorCard}>
                <Host style={StyleSheet.absoluteFill}>
                  <Menu
                    label={qualityLabel}
                    modifiers={[buttonStyle("plain"), foregroundColor(theme.colors.text)]}
                  >
                    {qualities.map((q) => (
                      <SwiftButton
                        key={q}
                        label={`${q}p`}
                        systemImage={q === selectedQuality ? "checkmark.circle.fill" : undefined}
                        onPress={() => handleSelectQuality(q)}
                      />
                    ))}
                  </Menu>
                </Host>
                <View style={styles.selectorCardContent} pointerEvents="none">
                  <Text style={styles.selectorCardValue} numberOfLines={1}>
                    {qualityLabel}
                  </Text>
                  <Ionicons name="chevron-down" size={14} color={theme.colors.muted} />
                </View>
              </View>
            ) : (
              <Pressable style={styles.selectorCard}>
                <Text style={styles.selectorCardValue}>{qualityLabel}</Text>
                <Ionicons name="chevron-down" size={14} color={theme.colors.muted} />
              </Pressable>
            )}
          </View>

          {/* Episode list */}
          <View style={styles.section}>
            <View style={styles.sectionRow}>
              <Text style={styles.sectionTitle}>{t("anime.selectEpisode")}</Text>
              {allEpisodes.length > 1 ? (
                <Pressable
                  onPress={() => {
                    const allIds = allEpisodes.map((e) => e.id);
                    const allSelected = selectedEpisodeIds.length === allIds.length;
                    setSelectedEpisodeIds(allSelected ? [] : allIds);
                  }}
                  disabled={metaLoading}
                >
                  <Text style={styles.sectionAction}>
                    {selectedEpisodeIds.length === allEpisodes.length
                      ? t("anime.deselectAll")
                      : t("anime.selectAll")}
                  </Text>
                </Pressable>
              ) : null}
            </View>

            <View style={styles.episodeList}>
              {allEpisodes.map((episode, index) => {
                const isSelected = selectedSet.has(episode.id);
                const state = getEpisodeState(episode.id);
                const isUnavailable =
                  state?.status === "completed" ||
                  state?.status === "downloading" ||
                  state?.status === "queued";
                const isLast = index === allEpisodes.length - 1;

                return (
                  <Pressable
                    key={episode.id}
                    style={[
                      styles.episodeRow,
                      !isLast && styles.episodeRowBorder,
                      isUnavailable && styles.episodeRowUnavailable,
                    ]}
                    onPress={() => !isUnavailable && toggleEpisode(episode.id)}
                    disabled={metaLoading || isUnavailable}
                  >
                    <View style={styles.episodeTextWrap}>
                      <Text style={styles.episodeTitle} numberOfLines={1}>
                        {displayEpisodeLabel(
                          episode,
                          t("anime.episodeFallbackTitle", { number: episode.episodeNumber }),
                        )}
                      </Text>
                      {state ? (
                        <View style={styles.episodeMetaRow}>
                          <Text style={styles.episodeState}>
                            {state.status === "completed"
                              ? (language === "ru" ? "Оффлайн" : "Offline")
                              : state.status === "downloading"
                                ? `${language === "ru" ? "Загрузка" : "Downloading"} ${toPercentLabel(state.progress)}`
                                : language === "ru" ? "В очереди" : "Queued"}
                          </Text>
                        </View>
                      ) : null}
                      {state && state.status !== "completed" ? (
                        <View style={styles.progressTrack}>
                          <View
                            style={[
                              styles.progressFill,
                              { width: `${Math.round(state.progress * 100)}%` },
                            ]}
                          />
                        </View>
                      ) : null}
                    </View>
                    <View
                      style={[
                        styles.checkbox,
                        isSelected && styles.checkboxSelected,
                        isUnavailable && styles.checkboxUnavailable,
                      ]}
                    >
                      {isSelected || isUnavailable ? (
                        <Ionicons
                          name={isUnavailable ? "checkmark" : "checkmark"}
                          size={14}
                          color={isUnavailable ? theme.colors.muted : theme.colors.onAccent}
                        />
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </ScrollView>

        {/* Footer */}
        <View style={styles.footer}>
          <Pressable
            style={[styles.queueBtn, !canQueue && styles.queueBtnDisabled]}
            onPress={handleQueue}
            disabled={!canQueue}
          >
            {queueing ? (
              <ActivityIndicator size="small" color={theme.colors.onAccent} />
            ) : (
              <Text style={styles.queueBtnText}>
                {`${t("anime.downloadEpisode")} (${selectedEpisodeIds.length})`}
              </Text>
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    </>
  );
}

const createStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 16,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
    },
    cover: {
      width: 48,
      height: 68,
      borderRadius: 8,
      backgroundColor: theme.colors.panelSoft,
    },
    headerText: {
      flex: 1,
      gap: 4,
    },
    headerTitle: {
      color: theme.colors.text,
      fontSize: 17,
      fontWeight: "700",
      lineHeight: 22,
    },
    headerSub: {
      color: theme.colors.muted,
      fontSize: 13,
    },
    scrollContent: {
      paddingHorizontal: 20,
      paddingTop: 16,
      paddingBottom: 16,
      gap: 24,
    },
    section: {
      gap: 10,
    },
    sectionRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    sectionTitle: {
      color: theme.colors.muted,
      fontSize: 11,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    sectionAction: {
      color: theme.colors.accent,
      fontSize: 13,
      fontWeight: "600",
    },
    loadingRow: {
      height: 44,
      justifyContent: "center",
    },
    hint: {
      color: theme.colors.muted,
      fontSize: 14,
    },
    selectorCard: {
      height: 52,
      borderRadius: 14,
      backgroundColor: theme.colors.panel,
      borderWidth: 1,
      borderColor: theme.colors.border,
      overflow: "hidden",
    },
    selectorCardContent: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      gap: 8,
    },
    selectorCardValue: {
      flex: 1,
      color: theme.colors.text,
      fontSize: 15,
      fontWeight: "600",
    },
    episodeList: {
      backgroundColor: theme.colors.panel,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.colors.border,
      overflow: "hidden",
    },
    episodeRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingVertical: 14,
      gap: 12,
    },
    episodeRowBorder: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
    },
    episodeRowUnavailable: {
      opacity: 0.5,
    },
    episodeTextWrap: {
      flex: 1,
      gap: 4,
    },
    episodeTitle: {
      color: theme.colors.text,
      fontSize: 15,
      fontWeight: "600",
    },
    episodeMetaRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    episodeState: {
      color: theme.colors.muted,
      fontSize: 12,
    },
    progressTrack: {
      height: 3,
      borderRadius: 999,
      backgroundColor: theme.colors.accentSurface,
      overflow: "hidden",
    },
    progressFill: {
      height: "100%",
      borderRadius: 999,
      backgroundColor: theme.colors.accent,
    },
    checkbox: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 2,
      borderColor: theme.colors.border,
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
    },
    checkboxSelected: {
      backgroundColor: theme.colors.accent,
      borderColor: theme.colors.accent,
    },
    checkboxUnavailable: {
      backgroundColor: theme.colors.panelSoft,
      borderColor: theme.colors.border,
    },
    footer: {
      paddingHorizontal: 20,
      paddingTop: 12,
      paddingBottom: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
    },
    queueBtn: {
      height: 52,
      borderRadius: 14,
      backgroundColor: theme.colors.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    queueBtnDisabled: {
      opacity: 0.5,
    },
    queueBtnText: {
      color: theme.colors.onAccent,
      fontSize: 16,
      fontWeight: "700",
    },
  });
