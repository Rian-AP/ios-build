import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { router, Stack } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { SearchBarCommands } from "react-native-screens";

import { AnimePosterCard } from "@/components/AnimePosterCard";
import {
  EmptyState,
  ScreenHeader,
  SectionHeader,
  StatusCard,
} from "@/components/ui";
import { AnimeCard, api, getApiErrorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

const SEARCH_HISTORY_KEY = "search_history_v1";
const MAX_HISTORY = 10;

type SearchBarChangeArg =
  | string
  | {
      nativeEvent?: {
        text?: string;
      };
    };

export default function SearchScreen() {
  const { t, language } = useI18n();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const contentContainerStyle = useMemo(
    () => [
      styles.container,
      { paddingTop: insets.top + 8, paddingBottom: 32 + insets.bottom },
    ],
    [insets.top, insets.bottom, styles.container],
  );

  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<AnimeCard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchBarRef = useRef<SearchBarCommands | null>(null);
  const queryRef = useRef("");
  const ignoreNextEmptyChangeFromCancelRef = useRef(false);

  const hasQuery = useMemo(() => query.trim().length > 0, [query]);
  const resultRows = useMemo(() => {
    const rows: AnimeCard[][] = [];
    for (let index = 0; index < results.length; index += 2) {
      rows.push(results.slice(index, index + 2));
    }
    return rows;
  }, [results]);

  useEffect(() => {
    queryRef.current = query;
  }, [query]);

  useEffect(() => {
    AsyncStorage.getItem(SEARCH_HISTORY_KEY).then((raw) => {
      if (!raw) return;
      try {
        setSearchHistory(JSON.parse(raw));
      } catch {
        // ignore broken history payload
      }
    });
  }, []);

  const saveToHistory = useCallback((raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;

    setSearchHistory((prev) => {
      const next = [trimmed, ...prev.filter((item) => item !== trimmed)].slice(
        0,
        MAX_HISTORY,
      );
      AsyncStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const removeFromHistory = useCallback((target: string) => {
    setSearchHistory((prev) => {
      const next = prev.filter((item) => item !== target);
      AsyncStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const clearAllHistory = useCallback(() => {
    setSearchHistory([]);
    AsyncStorage.removeItem(SEARCH_HISTORY_KEY);
  }, []);

  const runSearch = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) {
        setResults([]);
        setError(null);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        const data = await api.search(trimmed);
        setResults(data.results || []);
      } catch (err) {
        setError(getApiErrorMessage(err, language, t("search.error")));
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [language, t],
  );

  const clearSearch = useCallback(() => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = null;
    }

    setQuery("");
    setResults([]);
    setError(null);
    setLoading(false);
  }, []);

  const cancelSearchEditing = useCallback(() => {
    const preservedQuery = queryRef.current;
    const trimmed = preservedQuery.trim();
    ignoreNextEmptyChangeFromCancelRef.current = true;

    searchBarRef.current?.blur();
    Keyboard.dismiss();

    if (trimmed) {
      saveToHistory(trimmed);
    }

    if (trimmed) {
      requestAnimationFrame(() => {
        searchBarRef.current?.setText(preservedQuery);
      });
    }
  }, [saveToHistory]);

  const scheduleSearch = useCallback(
    (nextQuery: string) => {
      queryRef.current = nextQuery;
      setQuery(nextQuery);

      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }

      if (!nextQuery.trim()) {
        setResults([]);
        setError(null);
        setLoading(false);
        return;
      }

      searchDebounceRef.current = setTimeout(() => {
        runSearch(nextQuery);
      }, 350);
    },
    [runSearch],
  );

  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, []);

  const onSearchBarChange = useCallback(
    (arg: SearchBarChangeArg) => {
      const text =
        typeof arg === "string" ? arg : (arg.nativeEvent?.text ?? "");

      if (ignoreNextEmptyChangeFromCancelRef.current && !text) {
        ignoreNextEmptyChangeFromCancelRef.current = false;
        if (queryRef.current.trim()) {
          requestAnimationFrame(() => {
            searchBarRef.current?.setText(queryRef.current);
          });
        }
        return;
      }

      ignoreNextEmptyChangeFromCancelRef.current = false;
      scheduleSearch(text);
    },
    [scheduleSearch],
  );

  const onSearchSubmit = useCallback(() => {
    const trimmed = query.trim();
    if (!trimmed) return;

    Keyboard.dismiss();
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = null;
    }

    saveToHistory(trimmed);
    runSearch(trimmed);
  }, [query, runSearch, saveToHistory]);

  const openAnime = useCallback((id: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    router.push({ pathname: "/anime/[id]", params: { id } });
  }, []);

  return (
    <>
      <Stack.Screen
        options={{
          title: "",
          headerTransparent: true,
          headerShadowVisible: false,
          headerStyle: { backgroundColor: "transparent" },
        }}
      />

      <Stack.SearchBar
        ref={searchBarRef}
        placement="automatic"
        placeholder={t("search.placeholder")}
        onChangeText={onSearchBarChange}
        onSearchButtonPress={onSearchSubmit}
        onCancelButtonPress={cancelSearchEditing}
      />

      <ScrollView
        contentContainerStyle={contentContainerStyle}
        contentInsetAdjustmentBehavior="never"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        keyboardDismissMode="interactive"
        onTouchStart={Keyboard.dismiss}
        onScrollBeginDrag={Keyboard.dismiss}
      >
        <View style={styles.headerPad}>
          <ScreenHeader title={t("tabs.search")} />
        </View>

        {loading ? (
          <View style={styles.centerBlock}>
            <ActivityIndicator color={theme.colors.indicator} size="large" />
            <Text style={styles.loading}>{t("search.searching")}</Text>
          </View>
        ) : null}

        {error ? (
          <StatusCard title={t("search.error")} message={error} />
        ) : null}

        {!loading && !error && results.length > 0 ? (
          <View style={styles.resultsBlock}>
            <SectionHeader
              title={t("search.results", { count: results.length })}
            />
            <View style={styles.resultsGrid}>
              {resultRows.map((row, rowIndex) => (
                <View
                  key={`results-row-${rowIndex}`}
                  style={styles.resultsGridRow}
                >
                  {row.map((item) => (
                    <View
                      key={`${item.id}-${item.episode ?? "ep"}`}
                      style={styles.resultsGridItem}
                    >
                      <AnimePosterCard
                        item={item}
                        variant="grid"
                        onPress={openAnime}
                      />
                    </View>
                  ))}
                  {row.length === 1 ? (
                    <View style={styles.resultsGridItem} />
                  ) : null}
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {!loading && !error && hasQuery && results.length === 0 ? (
          <EmptyState
            title={t("search.noResults", { query: query.trim() })}
            body={t("search.subtitle")}
          />
        ) : null}

        {!hasQuery && searchHistory.length > 0 ? (
          <View style={styles.historyBlock}>
            <View style={styles.historyHeader}>
              <Text style={styles.historyTitle}>
                {t("search.recentSearches")}
              </Text>
              <Pressable onPress={clearAllHistory}>
                <Text style={styles.clearAll}>{t("search.clearAll")}</Text>
              </Pressable>
            </View>

            {searchHistory.map((item) => (
              <Pressable
                key={item}
                style={styles.historyRow}
                onPress={() => {
                  void Haptics.selectionAsync().catch(() => {});
                  scheduleSearch(item);
                  saveToHistory(item);
                }}
              >
                <Ionicons
                  name="time-outline"
                  size={18}
                  color={theme.colors.muted}
                />
                <Text style={styles.historyText} numberOfLines={1}>
                  {item}
                </Text>
                <Pressable onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                  removeFromHistory(item);
                }} hitSlop={8}>
                  <Ionicons name="close" size={16} color={theme.colors.muted} />
                </Pressable>
              </Pressable>
            ))}
          </View>
        ) : null}

        {!hasQuery && searchHistory.length === 0 && !loading && !error ? (
          <View style={styles.emptyHistoryFiller}>
            <Ionicons
              name="search-outline"
              size={74}
              color={theme.colors.muted}
            />
            <Text style={styles.emptyHistoryTitle}>
              {t("search.noHistory")}
            </Text>
            <Text style={styles.emptyHistoryBody}>
              {t("search.historyHint")}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}

const createStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    container: {
      paddingHorizontal: 16,
      paddingBottom: 32,
      gap: 16,
    },
    headerPad: {
      paddingBottom: 6,
    },
    centerBlock: {
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 40,
      paddingHorizontal: 16,
    },
    loading: {
      color: theme.colors.muted,
      marginTop: 10,
      fontSize: 14,
    },
    resultsBlock: {
      gap: 12,
    },
    resultsGrid: {
      gap: 12,
    },
    resultsGridRow: {
      flexDirection: "row",
      gap: 12,
      alignItems: "stretch",
    },
    resultsGridItem: {
      flex: 1,
      minWidth: 0,
    },
    historyBlock: {
      gap: 4,
    },
    historyHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 4,
    },
    historyTitle: {
      fontSize: 20,
      fontWeight: "700",
      color: theme.colors.text,
    },
    clearAll: {
      fontSize: 14,
      color: theme.colors.accent,
    },
    historyRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 12,
      paddingHorizontal: 4,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
    },
    historyText: {
      flex: 1,
      fontSize: 15,
      color: theme.colors.text,
    },
    emptyHistoryFiller: {
      alignItems: "center",
      justifyContent: "center",
      minHeight: 340,
      paddingHorizontal: 28,
      paddingVertical: 24,
      gap: 12,
    },
    emptyHistoryTitle: {
      fontSize: 26,
      lineHeight: 34,
      fontWeight: "800",
      textAlign: "center",
      color: theme.colors.text,
    },
    emptyHistoryBody: {
      fontSize: 16,
      lineHeight: 24,
      textAlign: "center",
      color: theme.colors.muted,
      maxWidth: 340,
    },
  });
