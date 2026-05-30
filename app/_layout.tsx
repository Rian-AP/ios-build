import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useEffect, useRef } from "react";
import "react-native-reanimated";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Platform } from "react-native";

import AsyncStorage from "@react-native-async-storage/async-storage";

import { getBookmarks } from "@/lib/bookmarks";
import { getDownloads, setDownloads } from "@/lib/downloads";
import { getHistory } from "@/lib/history";
import { I18nProvider, useI18n } from "@/lib/i18n";
import { removeOfflinePayload } from "@/lib/offlineDownloads";
import { supabase } from "@/lib/supabase";
import {
  backfillDownloadStreamUrls,
  debounced,
  fetchCloudSettings,
  isRealtimeSuppressed,
  mergeCloudBookmarks,
  mergeCloudDownloads,
  mergeCloudHistory,
  replaceLocalBookmarks,
  replaceLocalDownloads,
  replaceLocalHistory,
} from "@/lib/sync";
import { AppThemeProvider, useTheme, useThemeController } from "@/lib/theme";

function AppNavigator() {
  const { applyCloudLanguage } = useI18n();
  const theme = useTheme();
  const { isDark, applyCloudTheme } = useThemeController();

  // Keep refs fresh so Realtime closure always calls latest version
  const applyCloudThemeRef = useRef(applyCloudTheme);
  const applyCloudLanguageRef = useRef(applyCloudLanguage);
  useEffect(() => {
    applyCloudThemeRef.current = applyCloudTheme;
    applyCloudLanguageRef.current = applyCloudLanguage;
  });

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(theme.colors.background).catch(() => {
      // ignore root background update failures
    });
  }, [theme.colors.background]);

  useEffect(() => {
    if (!supabase) return;

    // Initial sync on mount — run once after session check
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) return;
      void Promise.all([
        getBookmarks().then((local) =>
          mergeCloudBookmarks(local, (merged) =>
            AsyncStorage.setItem('bookmarks_v1', JSON.stringify(merged))
          )
        ),
        getHistory().then((local) =>
          mergeCloudHistory(local, (merged) =>
            AsyncStorage.setItem('stream_history_v1', JSON.stringify(merged))
          )
        ),
        getDownloads().then((local) =>
          mergeCloudDownloads(local, setDownloads, (deleted) => {
            void removeOfflinePayload(deleted.storageDirUri);
          }).then(() => {
            // Backfill remote_stream_url for existing cloud records that don't have it yet
            void backfillDownloadStreamUrls();
          })
        ),
      ]);
    }).catch(() => undefined);

    // Realtime — debounced to avoid multiple parallel fetches on burst events
    const channel = supabase
      .channel('db-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookmarks' }, () => {
        debounced('sync:bookmarks', 800, () => {
          if (isRealtimeSuppressed('sync:bookmarks')) return;
          void replaceLocalBookmarks((items) =>
            AsyncStorage.setItem('bookmarks_v1', JSON.stringify(items))
          );
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'watch_history' }, () => {
        debounced('sync:history', 800, () => {
          if (isRealtimeSuppressed('sync:history')) return;
          void replaceLocalHistory((items) =>
            AsyncStorage.setItem('stream_history_v1', JSON.stringify(items))
          );
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'downloads_meta' }, () => {
        debounced('sync:downloads', 800, () => {
          if (isRealtimeSuppressed('sync:downloads')) return;
          void getDownloads().then((local) =>
            replaceLocalDownloads(local, setDownloads, (deleted) => {
              void removeOfflinePayload(deleted.storageDirUri);
            })
          );
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_settings' }, () => {
        debounced('sync:settings', 800, () => {
          void fetchCloudSettings().then((cloud) => {
            if (!cloud) return;
            applyCloudThemeRef.current(cloud.themeMode, cloud.accentHue);
            applyCloudLanguageRef.current(cloud.language);
          });
        });
      })
      .subscribe();

    return () => {
      void supabase!.removeChannel(channel);
    };
  }, []);

  return (
    <>
      <StatusBar style={isDark ? "light" : "dark"} />
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: theme.colors.background },
          headerStyle: { backgroundColor: theme.colors.background },
          headerTintColor: theme.colors.text,
          headerTitleStyle: { fontFamily: theme.typography.subheading },
          headerShadowVisible: false,
        }}
      >
        <Stack.Screen
          name="(tabs)"
          options={{
            headerShown: false,
            title: "",
            contentStyle: { backgroundColor: theme.colors.background },
          }}
        />
        <Stack.Screen
          name="account"
          options={{
            presentation: "modal",
            headerShown: true,
            headerStyle: { backgroundColor: theme.colors.background },
            headerTintColor: theme.colors.text,
            headerShadowVisible: false,
          }}
        />
        <Stack.Screen
          name="anime/[id]"
          options={{
            title: "",
            headerTransparent: true,
            headerBlurEffect: "none",
            scrollEdgeEffects: { top: "hidden", bottom: "hidden" },
            headerShadowVisible: false,
            headerStyle: { backgroundColor: "transparent" },
            headerTintColor: theme.colors.text,
            headerBackTitle: "",
            contentStyle: { backgroundColor: theme.colors.background },
            headerRightContainerStyle: { paddingRight: 8 },
          }}
        />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  useEffect(() => {
    // Start local proxy server for offline HLS playback on iOS.
    // AVPlayer cannot play local file:// m3u8 playlists, but it CAN
    // play http://localhost — the proxy serves cached segments transparently.
    if (Platform.OS === 'ios') {
      import('expo-video-cache').then(({ startServer }) => {
        startServer(9000, 512 * 1024 * 1024) // 512MB cache limit
          .catch(() => {}); // ignore if already running
      }).catch(() => {});
    }
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppThemeProvider>
        <I18nProvider>
          <AppNavigator />
        </I18nProvider>
      </AppThemeProvider>
    </GestureHandlerRootView>
  );
}
