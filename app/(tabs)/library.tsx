import { useFocusEffect, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useCallback, useMemo, useState } from "react";
import { Alert, Platform, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AnimePosterCard } from "@/components/AnimePosterCard";
import { EmptyState, ScreenHeader } from "@/components/ui";
import { BookmarkItem, clearBookmarks, getBookmarks } from "@/lib/bookmarks";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

export default function LibraryScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);

  const loadBookmarks = useCallback(async () => {
    const list = await getBookmarks();
    setBookmarks(list);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadBookmarks();
    }, [loadBookmarks]),
  );

  const rows = useMemo(() => {
    const output: BookmarkItem[][] = [];
    for (let index = 0; index < bookmarks.length; index += 2) {
      output.push(bookmarks.slice(index, index + 2));
    }
    return output;
  }, [bookmarks]);

  const handleClearAll = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    Alert.alert(
      t("library.clearBookmarksTitle"),
      t("library.clearBookmarksBody"),
      [
        { text: t("library.cancel"), style: "cancel" },
        {
          text: t("library.clearBookmarksAction"),
          style: "destructive",
          onPress: () => {
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
            void clearBookmarks().then(() => setBookmarks([]));
          },
        },
      ],
    );
  }, [t]);

  const openAnime = useCallback(
    (id: string) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      router.push({ pathname: "/anime/[id]", params: { id } });
    },
    [router],
  );

  return (
    <SafeAreaView
      style={styles.safeArea}
      edges={
        Platform.OS === "android" ? ["top", "left", "right"] : ["left", "right"]
      }
    >
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.container}
      >
        <ScreenHeader
          title={t("tabs.library")}
          action={
            bookmarks.length > 0
              ? {
                  label: t("library.clearBookmarksAction"),
                  onPress: handleClearAll,
                }
              : undefined
          }
        />

        {bookmarks.length === 0 ? (
          <EmptyState
            title={t("library.noBookmarksTitle")}
            body={t("library.noBookmarksBody")}
          />
        ) : (
          <View style={styles.grid}>
            {rows.map((row, rowIndex) => (
              <View key={`library-row-${rowIndex}`} style={styles.gridRow}>
                {row.map((item) => (
                  <View
                    key={`${item.animeId}-${item.savedAt}`}
                    style={styles.gridItem}
                  >
                    <AnimePosterCard
                      item={{
                        id: item.animeId,
                        title: item.animeTitleByLanguage || {
                          en: item.animeTitle,
                          ru: item.animeTitle,
                        },
                        cover: item.cover,
                      }}
                      variant="grid"
                      onPress={openAnime}
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
      gap: 12,
    },
    gridRow: {
      flexDirection: "row",
      gap: 12,
      alignItems: "stretch",
    },
    gridItem: {
      flex: 1,
      minWidth: 0,
    },
  });
