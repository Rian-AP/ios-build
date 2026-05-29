import { Ionicons } from '@expo/vector-icons';
import type { Session } from '@supabase/supabase-js';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getBookmarks } from '@/lib/bookmarks';
import { getDownloads, setDownloads } from '@/lib/downloads';
import { getHistory } from '@/lib/history';
import { useI18n } from '@/lib/i18n';
import { removeOfflinePayload } from '@/lib/offlineDownloads';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { mergeCloudBookmarks, mergeCloudHistory, mergeCloudDownloads } from '@/lib/sync';
import { useTheme } from '@/lib/theme';
import AsyncStorage from '@react-native-async-storage/async-storage';

type Screen = 'login' | 'register' | 'profile';

const getAuthErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
};

export default function AccountScreen() {
  const { t } = useI18n();
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [screen, setScreen] = useState<Screen>('login');
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;

    let mounted = true;

    supabase.auth
      .getSession()
      .then(({ data, error: sessionError }) => {
        if (!mounted) return;
        if (sessionError) {
          setError(sessionError.message);
          return;
        }
        setSession(data.session);
        if (data.session) {
          setScreen('profile');
          void getBookmarks().then((local) =>
            mergeCloudBookmarks(local, (merged) =>
              AsyncStorage.setItem('bookmarks_v1', JSON.stringify(merged))
            )
          );
          void getHistory().then((local) =>
            mergeCloudHistory(local, (merged) =>
              AsyncStorage.setItem('stream_history_v1', JSON.stringify(merged))
            )
          );
          void getDownloads().then((local) =>
            mergeCloudDownloads(local, setDownloads, (deleted) => {
              void removeOfflinePayload(deleted.storageDirUri);
            })
          );
        }
      })
      .catch((err: unknown) => {
        if (mounted) {
          setError(getAuthErrorMessage(err, t('account.loginError')));
        }
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setScreen(nextSession ? 'profile' : 'login');
      if (nextSession) {
        setError(null);
        setInfo(null);
        void getBookmarks().then((local) =>
          mergeCloudBookmarks(local, (merged) =>
            AsyncStorage.setItem('bookmarks_v1', JSON.stringify(merged))
          )
        );
        void getHistory().then((local) =>
          mergeCloudHistory(local, (merged) =>
            AsyncStorage.setItem('stream_history_v1', JSON.stringify(merged))
          )
        );
        void getDownloads().then((local) =>
          mergeCloudDownloads(local, setDownloads, (deleted) => {
            void removeOfflinePayload(deleted.storageDirUri);
          })
        );
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [t]);

  const handleLogin = async () => {
    const normalizedEmail = email.trim();
    if (!normalizedEmail || !password) {
      setError(t('account.fillAllFields'));
      return;
    }
    if (!supabase) {
      setError(t('account.notConnected'));
      return;
    }
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });
      if (authError) throw authError;
      setSession(data.session);
      setScreen(data.session ? 'profile' : 'login');
      setEmail(normalizedEmail);
      setPassword('');
    } catch (err) {
      setError(getAuthErrorMessage(err, t('account.loginError')));
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    const normalizedEmail = email.trim();
    if (!normalizedEmail || !password) {
      setError(t('account.fillAllFields'));
      return;
    }
    if (!supabase) {
      setError(t('account.notConnected'));
      return;
    }
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const { data, error: authError } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
      });
      if (authError) throw authError;
      setEmail(normalizedEmail);
      setPassword('');
      if (data.session) {
        setSession(data.session);
        setScreen('profile');
      } else {
        setScreen('login');
        setInfo(t('account.checkEmail'));
      }
    } catch (err) {
      setError(getAuthErrorMessage(err, t('account.registerError')));
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    if (!supabase) {
      setError(t('account.notConnected'));
      return;
    }
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const { error: authError } = await supabase.auth.signOut();
      if (authError) throw authError;
      setSession(null);
      setScreen('login');
      setPassword('');
    } catch (err) {
      setError(getAuthErrorMessage(err, t('account.loginError')));
    } finally {
      setLoading(false);
    }
  };

  const router = useRouter();
  const authEmail = session?.user.email || email.trim();
  const isProfile = screen === 'profile' && Boolean(session);

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom', 'left', 'right']}>
      <Stack.Screen
        options={{
          title: screen === 'profile' ? t('account.profile') : t('account.signIn'),
          headerRight: () => (
            <Pressable onPress={() => router.back()} hitSlop={8}>
              <Text style={{ color: theme.colors.accent, fontSize: 17, fontWeight: '600' }}>
                {t('library.cancel')}
              </Text>
            </Pressable>
          ),
        }}
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.avatar, { backgroundColor: theme.colors.accentSurface }]}>
            <Ionicons name="person" size={48} color={theme.colors.accent} />
          </View>

          <Text style={[styles.title, { color: theme.colors.text }]}>
            {isProfile
              ? t('account.profile')
              : screen === 'login'
                ? t('account.signIn')
                : t('account.signUp')}
          </Text>
          <Text style={[styles.subtitle, { color: theme.colors.muted }]}>
            {isProfile
              ? t('account.signedInAs', { email: authEmail || '-' })
              : screen === 'login'
                ? t('account.signInHint')
                : t('account.signUpHint')}
          </Text>

          {isProfile ? (
            <View style={styles.form}>
              {error ? (
                <Text style={[styles.errorText, { color: theme.colors.dangerText }]}>
                  {error}
                </Text>
              ) : null}

              <Pressable
                style={[styles.primaryBtn, { backgroundColor: theme.colors.accent }]}
                onPress={handleSignOut}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color={theme.colors.onAccent} size="small" />
                ) : (
                  <Text style={styles.primaryBtnText}>{t('account.signOut')}</Text>
                )}
              </Pressable>
            </View>
          ) : (
            <>
              <View style={styles.form}>
                <View style={[styles.inputWrap, { backgroundColor: theme.colors.panel, borderColor: theme.colors.border }]}>
                  <Ionicons name="mail-outline" size={18} color={theme.colors.muted} style={styles.inputIcon} />
                  <TextInput
                    style={[styles.input, { color: theme.colors.text }]}
                    placeholder={t('account.emailPlaceholder')}
                    placeholderTextColor={theme.colors.muted}
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    autoCorrect={false}
                    returnKeyType="next"
                  />
                </View>

                <View style={[styles.inputWrap, { backgroundColor: theme.colors.panel, borderColor: theme.colors.border }]}>
                  <Ionicons name="lock-closed-outline" size={18} color={theme.colors.muted} style={styles.inputIcon} />
                  <TextInput
                    style={[styles.input, { color: theme.colors.text }]}
                    placeholder={t('account.passwordPlaceholder')}
                    placeholderTextColor={theme.colors.muted}
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry
                    returnKeyType="done"
                    onSubmitEditing={screen === 'login' ? handleLogin : handleRegister}
                  />
                </View>

                {error ? (
                  <Text style={[styles.errorText, { color: theme.colors.dangerText }]}>
                    {error}
                  </Text>
                ) : null}

                {info ? (
                  <Text style={[styles.infoText, { color: theme.colors.success }]}>
                    {info}
                  </Text>
                ) : null}

                <Pressable
                  style={[styles.primaryBtn, { backgroundColor: theme.colors.accent }]}
                  onPress={screen === 'login' ? handleLogin : handleRegister}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color={theme.colors.onAccent} size="small" />
                  ) : (
                    <Text style={styles.primaryBtnText}>
                      {screen === 'login' ? t('account.signIn') : t('account.signUp')}
                    </Text>
                  )}
                </Pressable>
              </View>

              <View style={styles.switchRow}>
                <Text style={[styles.switchText, { color: theme.colors.muted }]}>
                  {screen === 'login' ? t('account.noAccount') : t('account.hasAccount')}
                </Text>
                <Pressable
                  onPress={() => {
                    setError(null);
                    setInfo(null);
                    setScreen(screen === 'login' ? 'register' : 'login');
                  }}
                >
                  <Text style={[styles.switchLink, { color: theme.colors.accent }]}>
                    {screen === 'login' ? t('account.signUp') : t('account.signIn')}
                  </Text>
                </Pressable>
              </View>
            </>
          )}

          {!isSupabaseConfigured ? (
            <View style={[styles.noticeBanner, { backgroundColor: theme.colors.warningSurface }]}>
              <Ionicons name="information-circle-outline" size={16} color={theme.colors.warningText} />
              <Text style={[styles.noticeText, { color: theme.colors.warningText }]}>
                {t('account.notConnected')}
              </Text>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: theme.colors.background },
    flex: { flex: 1 },
    container: {
      padding: 24,
      gap: 16,
      alignItems: 'center',
    },
    avatar: {
      width: 88,
      height: 88,
      borderRadius: 44,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 16,
      marginBottom: 4,
    },
    title: {
      fontSize: 26,
      fontWeight: '800',
      textAlign: 'center',
    },
    subtitle: {
      fontSize: 15,
      textAlign: 'center',
      lineHeight: 21,
      maxWidth: 300,
      marginBottom: 4,
    },
    form: {
      width: '100%',
      gap: 12,
    },
    inputWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: 14,
      borderWidth: 1,
      paddingHorizontal: 14,
      height: 52,
      gap: 10,
    },
    inputIcon: {
      flexShrink: 0,
    },
    input: {
      flex: 1,
      fontSize: 16,
      height: '100%',
    },
    errorText: {
      fontSize: 13,
      lineHeight: 18,
      textAlign: 'center',
    },
    infoText: {
      fontSize: 13,
      lineHeight: 18,
      textAlign: 'center',
      fontWeight: '600',
    },
    primaryBtn: {
      height: 52,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 4,
    },
    primaryBtnText: {
      color: theme.colors.onAccent,
      fontSize: 16,
      fontWeight: '700',
    },
    switchRow: {
      flexDirection: 'row',
      gap: 6,
      alignItems: 'center',
    },
    switchText: {
      fontSize: 14,
    },
    switchLink: {
      fontSize: 14,
      fontWeight: '700',
    },
    noticeBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      padding: 12,
      borderRadius: 12,
      width: '100%',
    },
    noticeText: {
      flex: 1,
      fontSize: 13,
      lineHeight: 18,
    },
  });
