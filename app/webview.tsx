import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import { StatusCard } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';

const isWebUrl = (value: string) => /^https?:\/\/\S+$/i.test(value);
const WEBVIEW_TOP_OFFSET = 10;
const WEBVIEW_BOTTOM_OFFSET = 10;
const DISABLE_WEB_BLUR_JS = `
(() => {
  const css =
    '*{-webkit-backdrop-filter:none!important;backdrop-filter:none!important;}' +
    'header,[class*="header"],[class*="Header"],[class*="topbar"],[class*="TopBar"],[class*="navbar"],[class*="NavBar"]{-webkit-backdrop-filter:none!important;backdrop-filter:none!important;}';

  const apply = () => {
    if (!document || !document.documentElement) return;
    let style = document.getElementById('__rn_disable_web_blur__');
    if (!style) {
      style = document.createElement('style');
      style.id = '__rn_disable_web_blur__';
      (document.head || document.documentElement).appendChild(style);
    }
    if (style.textContent !== css) {
      style.textContent = css;
    }
  };

  apply();
  window.addEventListener('DOMContentLoaded', apply, { once: true });
})();
true;
`;

export default function WebViewScreen() {
  const { t } = useI18n();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ url?: string }>();

  const url = useMemo(() => String(params.url || '').trim(), [params.url]);

  const isValid = isWebUrl(url);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      edges={['left', 'right']}
    >
      <Stack.Screen
        options={{
          headerShown: true,
          headerTransparent: true,
          title: '',
          headerBackTitle: '',
          headerShadowVisible: false,
          headerStyle: { backgroundColor: 'transparent' },
          headerTintColor: theme.colors.text,
          headerBlurEffect: 'none',
          headerBackground: () => <View style={styles.headerClear} />,
          scrollEdgeEffects: { top: 'hidden', bottom: 'hidden' },
        }}
      />

      {!isValid ? (
        <View style={styles.center}>
          <StatusCard title={t('anime.error')} message={t('anime.externalLinkUnavailable')} />
        </View>
      ) : (
        <WebView
          source={{ uri: url }}
          startInLoadingState
          setSupportMultipleWindows={false}
          injectedJavaScriptBeforeContentLoaded={DISABLE_WEB_BLUR_JS}
          injectedJavaScript={DISABLE_WEB_BLUR_JS}
          bounces={false}
          overScrollMode="never"
          pullToRefreshEnabled={false}
          contentInset={{
            top: insets.top + WEBVIEW_TOP_OFFSET,
            left: 0,
            right: 0,
            bottom: insets.bottom + WEBVIEW_BOTTOM_OFFSET,
          }}
          contentInsetAdjustmentBehavior="never"
          style={styles.webview}
          renderLoading={() => (
            <View style={styles.loader}>
              <ActivityIndicator size="small" color={theme.colors.indicator} />
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    padding: 16,
    justifyContent: 'center',
  },
  webview: {
    flex: 1,
  },
  loader: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerClear: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});
