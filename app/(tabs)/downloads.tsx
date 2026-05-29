import { useFocusEffect, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert,
    Platform,
    ScrollView,
    StyleSheet,
    View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AnimePosterCard } from '@/components/AnimePosterCard';
import { EmptyState, ScreenHeader } from '@/components/ui';
import { clearDownloads, DownloadItem, getDownloads, subscribeDownloads } from '@/lib/downloads';
import { useI18n } from '@/lib/i18n';
import { removeOfflinePayload } from '@/lib/offlineDownloads';
import { useTheme } from '@/lib/theme';

type DownloadAnimeCard = {
  animeId: string;
  animeTitle: string;
  animeTitleByLanguage?: DownloadItem['animeTitleByLanguage'];
  cover?: string | null;
  totalCount: number;
  completedCount: number;
  downloadingCount: number;
  failedCount: number;
  queuedCount: number;
  averageProgress: number;
  lastUpdatedAt: number;
  openEpisodeId: string;
  openTeamSlug?: string | null;
  openQuality?: string | null;
  openEpisodeNumber?: string | null;
};

const clamp01 = (value: number) => Math.max(0, Math.min(value, 1));

const toAnimeCards = (items: DownloadItem[]): DownloadAnimeCard[] => {
  const byAnime = new Map<string, DownloadAnimeCard>();

  for (const item of items) {
    const key = String(item.animeId || '').trim();
    if (!key) continue;

    const existing = byAnime.get(key);
    const itemProgress = clamp01(Number(item.progress || 0));

    if (!existing) {
      byAnime.set(key, {
        animeId: key,
        animeTitle: item.animeTitle || key,
        animeTitleByLanguage: item.animeTitleByLanguage,
        cover: item.cover || null,
        totalCount: 1,
        completedCount: item.status === 'completed' ? 1 : 0,
        downloadingCount: item.status === 'downloading' ? 1 : 0,
        failedCount: item.status === 'failed' ? 1 : 0,
        queuedCount: item.status === 'queued' ? 1 : 0,
        averageProgress: item.status === 'completed' ? 1 : itemProgress,
        lastUpdatedAt: Number(item.updatedAt || 0),
        openEpisodeId: item.episodeId,
        openTeamSlug: item.teamSlug || null,
        openQuality: item.quality || null,
        openEpisodeNumber: item.episodeNumber || null,
      });
      continue;
    }

    existing.totalCount += 1;
    if (item.status === 'completed') existing.completedCount += 1;
    if (item.status === 'downloading') existing.downloadingCount += 1;
    if (item.status === 'failed') existing.failedCount += 1;
    if (item.status === 'queued') existing.queuedCount += 1;
    if (!existing.animeTitleByLanguage && item.animeTitleByLanguage) {
      existing.animeTitleByLanguage = item.animeTitleByLanguage;
      existing.animeTitle = item.animeTitle;
    }
    if (!existing.cover && item.cover) {
      existing.cover = item.cover;
    }

    const progressContribution = item.status === 'completed' ? 1 : itemProgress;
    existing.averageProgress =
      ((existing.averageProgress * (existing.totalCount - 1)) + progressContribution) / existing.totalCount;

    if (Number(item.updatedAt || 0) >= existing.lastUpdatedAt) {
      existing.lastUpdatedAt = Number(item.updatedAt || 0);
      existing.openEpisodeId = item.episodeId;
      existing.openTeamSlug = item.teamSlug || null;
      existing.openQuality = item.quality || null;
      existing.openEpisodeNumber = item.episodeNumber || null;
    }

    const shouldPreferCompleted =
      item.status === 'completed' &&
      existing.openEpisodeId !== item.episodeId &&
      existing.completedCount > 0;
    if (shouldPreferCompleted) {
      existing.openEpisodeId = item.episodeId;
      existing.openTeamSlug = item.teamSlug || null;
      existing.openQuality = item.quality || null;
      existing.openEpisodeNumber = item.episodeNumber || null;
    }
  }

  return Array.from(byAnime.values()).sort((left, right) => right.lastUpdatedAt - left.lastUpdatedAt);
};

export default function DownloadsScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [items, setItems] = useState<DownloadItem[]>([]);

  const loadDownloads = useCallback(async () => {
    const list = await getDownloads();
    setItems(list);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadDownloads();
    }, [loadDownloads])
  );

  const lastStatusSigRef = useRef<string>('');
  useEffect(() => {
    const unsubscribe = subscribeDownloads((next) => {
      const sig = next.map((i) => `${i.id}:${i.status}`).join('|');
      if (sig !== lastStatusSigRef.current) {
        lastStatusSigRef.current = sig;
        setItems(next);
      }
    });
    return unsubscribe;
  }, []);

  const cards = useMemo(() => toAnimeCards(items), [items]);
  const rows = useMemo(() => {
    const output: DownloadAnimeCard[][] = [];
    for (let index = 0; index < cards.length; index += 2) {
      output.push(cards.slice(index, index + 2));
    }
    return output;
  }, [cards]);

  const handleClearAll = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    Alert.alert(t('downloads.clearAllTitle'), t('downloads.clearAllBody'), [
      { text: t('library.cancel'), style: 'cancel' },
      {
        text: t('downloads.clearAllAction'),
        style: 'destructive',
        onPress: () => {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
          void Promise.allSettled(items.map((item) => removeOfflinePayload(item.storageDirUri)))
            .then(() => clearDownloads())
            .then(() => setItems([]));
        },
      },
    ]);
  }, [items, t]);

  const openOfflineAnime = useCallback((item: DownloadAnimeCard) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    router.push({
      pathname: '/anime/[id]',
      params: {
        id: item.animeId,
        episodeId: item.openEpisodeId,
        historyTeamSlug: item.openTeamSlug || '',
        historyQuality: item.openQuality || '',
        offlineOnly: '1',
      },
    });
  }, [router]);

  return (
    <SafeAreaView
      style={styles.safeArea}
      edges={Platform.OS === 'android' ? ['top', 'left', 'right'] : ['left', 'right']}
    >
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.container}>
        <ScreenHeader
          title={t('tabs.downloads')}
          action={items.length > 0 ? { label: t('downloads.clearAllAction'), onPress: handleClearAll } : undefined}
        />

        {cards.length === 0 ? (
          <EmptyState title={t('downloads.emptyTitle')} body={t('downloads.emptyBody')} />
        ) : (
          <View style={styles.grid}>
            {rows.map((row, rowIndex) => (
              <View key={`downloads-row-${rowIndex}`} style={styles.gridRow}>
                {row.map((item) => (
                  <View key={`${item.animeId}-${item.lastUpdatedAt}`} style={styles.gridItem}>
                    <AnimePosterCard
                      item={{
                        id: item.animeId,
                        title: item.animeTitleByLanguage || { en: item.animeTitle, ru: item.animeTitle },
                        cover: item.cover || null,
                      }}
                      variant="grid"
                      onPress={() => openOfflineAnime(item)}
                    />
                  </View>
                ))}
                {row.length === 1 ? <View style={styles.gridItem} /> : null}
              </View>
            ))}
          </View>
        )}
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
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 32,
      gap: 16,
    },
    grid: {
      gap: 14,
    },
    gridRow: {
      flexDirection: 'row',
      gap: 12,
      alignItems: 'stretch',
    },
    gridItem: {
      flex: 1,
      minWidth: 0,
      gap: 6,
    },
  });
