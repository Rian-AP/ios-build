import { fetchCloudSettings, pushSettingsToCloud } from "@/lib/sync";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
} from "react";

export type AppLanguage = "en" | "ru";

const STORAGE_KEY = "app_language";

const translations = {
  en: {
    "tabs.home": "Home",
    "tabs.search": "Search",
    "tabs.library": "Library",
    "tabs.downloads": "Downloads",
    "tabs.history": "History",
    "tabs.settings": "Settings",
    "tabs.streamFeed": "Stream Feed",
    "tabs.searchAnime": "Search Anime",
    "tabs.continueWatching": "Continue Watching",
    "tabs.appSettings": "App Settings",
    "stack.animeDetails": "Anime Details",
    "stack.player": "Player",
    "notFound.title": "Not Found",
    "notFound.message": "This screen doesn't exist.",
    "notFound.action": "Go to home screen",
    "settings.title": "Settings",
    "settings.subtitle": "Configure app behavior and backend links.",
    "settings.appearance": "Appearance",
    "settings.accent": "Accent Color",
    "settings.theme": "Theme",
    "settings.themeHint": "Choose how the app appearance should behave.",
    "settings.themeSystem": "Automatic",
    "settings.themeLight": "Light",
    "settings.themeDark": "Dark",
    "settings.themeSystemFooter":
      "Automatic follows your device's system appearance.",
    "settings.language": "Language",
    "settings.languageHint": "Choose interface language.",
    "settings.english": "English",
    "settings.russian": "Russian",
    "settings.apiBaseUrl": "API Base URL",
    "settings.quickLinks": "Quick Links",
    "settings.openSwagger": "Open Swagger UI",
    "settings.openHealth": "Open Health Check",
    "settings.openSwaggerJson": "Open swagger.json",
    "settings.navigationModel": "Navigation Model",
    "settings.navigationTabs":
      "Tabs: Home / Search / Library / Downloads / Settings",
    "settings.navigationStack": "Stack: Anime details and full player screens",
    "home.watchNow": "Watch Now",
    "home.subtitle": "Fresh episodes and trending picks from your API",
    "home.loading": "Loading stream feed...",
    "home.error": "Failed to load feed",
    "home.retry": "Tap to retry",
    "home.highlights": "Highlights",
    "home.latest": "Latest",
    "search.title": "Find anything",
    "search.subtitle": "Search by anime title or keyword.",
    "search.placeholder": "e.g. one piece",
    "search.go": "Go",
    "search.searching": "Searching...",
    "search.error": "Search error",
    "search.results": "{{count}} results",
    "search.noResults": 'No results for "{{query}}"',
    "search.recentSearches": "Recent",
    "search.clearAll": "Clear All",
    "search.noHistory": "No recent searches",
    "search.historyHint": "Your searches will appear here.",
    "search.trendingTip": "Try searching for One Piece, Naruto or Bleach.",
    "library.clearHistoryTitle": "Clear history",
    "library.clearHistoryBody": "Remove all saved episodes from this device?",
    "library.cancel": "Cancel",
    "library.clear": "Clear",
    "library.title": "Continue Watching",
    "library.savedItems": "{{count}} saved items on this device",
    "library.noHistoryTitle": "No history yet",
    "library.noHistoryBody":
      "Open an anime and play an episode to see it here.",
    "library.bookmarksTitle": "Bookmarks",
    "library.bookmarksItems": "{{count}} bookmarked",
    "library.noBookmarksTitle": "No bookmarks yet",
    "library.lastEpisode": "Last episode",
    "library.noCover": "NO COVER",
    "downloads.emptyTitle": "No downloads yet",
    "downloads.emptyBody":
      "Downloaded episodes will appear here for offline playback.",
    "downloads.clearAllTitle": "Clear download list",
    "downloads.clearAllBody": "Remove all download records from this device?",
    "downloads.clearAllAction": "Clear all",
    "downloads.removeAction": "Remove",
    "downloads.status.downloading": "Downloading",
    "downloads.status.queued": "Queued",
    "downloads.status.paused": "Paused",
    "downloads.status.failed": "Failed",
    "downloads.status.completed": "Completed",
    "anime.defaultTitle": "Anime",
    "anime.missingId": "Missing anime id",
    "anime.loading": "Loading details...",
    "anime.error": "Failed to load anime",
    "anime.retry": "Retry",
    "anime.about": "About",
    "anime.dub": "Dub",
    "anime.nowPlaying": "LIVE",
    "anime.status": "Status",
    "anime.score": "Score",
    "anime.type": "Type",
    "anime.ageRating": "Age rating",
    "anime.releaseDate": "Release",
    "anime.duration": "Duration",
    "anime.unknown": "Unknown",
    "anime.notAvailable": "N/A",
    "anime.noCover": "NO COVER",
    "anime.episodes": "Episodes",
    "anime.noEpisodes": "No episodes found.",
    "anime.episodeNumber": "Episode #{{number}}",
    "anime.play": "PLAY",
    "anime.playback": "Playback",
    "anime.playerHint":
      "Select episode, voice track, and quality without leaving this page.",
    "anime.selectEpisode": "Episode",
    "anime.selectVoice": "Voice / Subs",
    "anime.selectQuality": "Quality",
    "anime.noPlayers": "No voice tracks available for this episode yet.",
    "anime.noQualities": "No quality variants available.",
    "anime.loadingStream": "Preparing stream...",
    "anime.playbackUnavailable": "Playback unavailable for this selection.",
    "anime.openSelector": "Open selector",
    "anime.relatedAnime": "Related",
    "anime.fullscreen": "Fullscreen",
    "player.nowPlaying": "Now Playing",
    "player.missingEpisodeId": "Missing episode id",
    "player.source": "Source",
    "player.appleTracks": "Apple tracks",
    "player.loading": "Resolving stream...",
    "player.error": "Playback unavailable",
    "player.retry": "Retry",
    "player.streamUnavailable": "Stream URL is unavailable for this episode.",
    "player.playbackFailed": "Playback failed on this source.",
    "player.source.none": "none",
    "player.source.proxy": "proxy",
    "player.source.direct": "direct",
    "anime.tracks": "Tracks: {{count}}",
    "anime.untitled": "Untitled",
    "anime.unknownRelation": "Related",
    "anime.unknownPlayer": "Unknown",
    "anime.unknownTeam": "Unknown Team",
    "anime.unknownTranslation": "Unknown",
    "anime.episodeLabel": "EP {{number}}",
    "anime.unknownEpisode": "Episode",
    "anime.episodeFallbackTitle": "Episode {{number}}",
    "errors.requestFailed": "Request failed ({{status}})",
    "errors.requestTimeout": "Request timed out after {{seconds}}s",
    "anime.discovering": "Discovering anime...",
    "anime.retryIn": "Retrying in {{seconds}}s",
    "anime.showMore": "Read more",
    "anime.showLess": "Show less",
    "anime.openOnShikimori": "Shikimori",
    "anime.openOnAniList": "AniList",
    "anime.sourceManga": "Source manga",
    "anime.externalLinks": "External Links",
    "anime.externalLinkUnavailable": "Cannot open this link on the device.",
    "anime.downloadEpisode": "Download episode",
    "anime.downloadQueued": "Added to download queue",
    "anime.downloadingEpisode": "Downloading… {{percent}}",
    "anime.downloadedEpisode": "Available offline",
    "anime.downloadFailed": "Download failed. Try again.",
    "anime.selectAll": "Select all",
    "anime.deselectAll": "Deselect all",
    "account.signIn": "Sign In",
    "account.signUp": "Sign Up",
    "account.profile": "Account",
    "account.signInHint":
      "Sign in to sync your bookmarks and history across devices.",
    "account.signUpHint":
      "Create an account to save your progress in the cloud.",
    "account.emailPlaceholder": "Email",
    "account.passwordPlaceholder": "Password",
    "account.fillAllFields": "Please fill in all fields.",
    "account.loginError": "Login failed. Check your email and password.",
    "account.registerError": "Registration failed. Try again.",
    "account.noAccount": "No account?",
    "account.hasAccount": "Already have an account?",
    "account.notConnected":
      "Supabase not connected yet — add API keys to enable auth.",
    "account.signedInAs": "Signed in as {{email}}",
    "account.signOut": "Sign Out",
    "account.checkEmail": "Check your email to confirm registration.",
    "anime.download": "Download",
    "anime.addBookmark": "Add to Bookmarks",
    "anime.removeBookmark": "Remove from Bookmarks",
    "library.noBookmarksBody":
      "Tap the bookmark icon on any anime page to save it here.",
    "library.clearBookmarksTitle": "Clear bookmarks",
    "library.clearBookmarksBody": "Remove all bookmarks from this device?",
    "library.clearBookmarksAction": "Clear",
  },
  ru: {
    "tabs.home": "Главная",
    "tabs.search": "Поиск",
    "tabs.library": "Закладки",
    "tabs.downloads": "Загрузки",
    "tabs.history": "История",
    "tabs.settings": "Меню",
    "tabs.streamFeed": "Лента",
    "tabs.searchAnime": "Поиск аниме",
    "tabs.continueWatching": "Продолжить просмотр",
    "tabs.appSettings": "Настройки",
    "stack.animeDetails": "Детали аниме",
    "stack.player": "Плеер",
    "notFound.title": "Не найдено",
    "notFound.message": "Такого экрана нет.",
    "notFound.action": "На главную",
    "settings.title": "Настройки",
    "settings.subtitle": "Настрой параметры приложения и ссылки бэкенда.",
    "settings.appearance": "Оформление",
    "settings.accent": "Акцентный цвет",
    "settings.theme": "Тема",
    "settings.themeHint":
      "Выбери, как должно вести себя оформление приложения.",
    "settings.themeSystem": "Автоматически",
    "settings.themeLight": "Светлая",
    "settings.themeDark": "Тёмная",
    "settings.themeSystemFooter":
      "Автоматический режим следует системной теме устройства.",
    "settings.language": "Язык",
    "settings.languageHint": "Выбери язык интерфейса.",
    "settings.english": "English",
    "settings.russian": "Русский",
    "settings.apiBaseUrl": "Базовый URL API",
    "settings.quickLinks": "Быстрые ссылки",
    "settings.openSwagger": "Открыть Swagger UI",
    "settings.openHealth": "Открыть Health Check",
    "settings.openSwaggerJson": "Открыть swagger.json",
    "settings.navigationModel": "Навигация",
    "settings.navigationTabs":
      "Вкладки: Главная / Поиск / Библиотека / Загрузки / Настройки",
    "settings.navigationStack": "Стек: детали аниме и экран плеера",
    "home.watchNow": "Смотреть сейчас",
    "home.subtitle": "Свежие серии и популярные тайтлы из твоего API",
    "home.loading": "Загружаем ленту...",
    "home.error": "Не удалось загрузить ленту",
    "home.retry": "Нажми, чтобы повторить",
    "home.highlights": "Рекомендации",
    "home.latest": "Новые",
    "search.title": "Найди что угодно",
    "search.subtitle": "Поиск по названию аниме или ключевому слову.",
    "search.placeholder": "например, one piece",
    "search.go": "Искать",
    "search.searching": "Ищем...",
    "search.error": "Ошибка поиска",
    "search.results": "Результатов: {{count}}",
    "search.noResults": 'Ничего не найдено по запросу "{{query}}"',
    "search.recentSearches": "Недавние",
    "search.clearAll": "Очистить",
    "search.noHistory": "Нет недавних запросов",
    "search.historyHint": "Твои запросы появятся здесь.",
    "search.trendingTip": "Попробуй One Piece, Naruto или Bleach.",
    "library.clearHistoryTitle": "Очистить историю",
    "library.clearHistoryBody":
      "Удалить все сохраненные эпизоды с этого устройства?",
    "library.cancel": "Отмена",
    "library.clear": "Очистить",
    "library.title": "Продолжить просмотр",
    "library.savedItems": "Сохранено на устройстве: {{count}}",
    "library.noHistoryTitle": "История пока пуста",
    "library.noHistoryBody":
      "Открой аниме и запусти эпизод, чтобы он появился здесь.",
    "library.bookmarksTitle": "Закладки",
    "library.bookmarksItems": "В закладках: {{count}}",
    "library.noBookmarksTitle": "Закладок пока нет",
    "library.lastEpisode": "Последний эпизод",
    "library.noCover": "БЕЗ ОБЛОЖКИ",
    "downloads.emptyTitle": "Загрузок пока нет",
    "downloads.emptyBody": "Здесь появятся серии для оффлайн-просмотра.",
    "downloads.clearAllTitle": "Очистить список загрузок",
    "downloads.clearAllBody":
      "Удалить все записи о загрузках с этого устройства?",
    "downloads.clearAllAction": "Очистить всё",
    "downloads.removeAction": "Убрать",
    "downloads.status.downloading": "Загружается",
    "downloads.status.queued": "В очереди",
    "downloads.status.paused": "Пауза",
    "downloads.status.failed": "Ошибка",
    "downloads.status.completed": "Готово",
    "anime.defaultTitle": "Аниме",
    "anime.missingId": "Отсутствует id аниме",
    "anime.loading": "Загружаем детали...",
    "anime.error": "Не удалось загрузить аниме",
    "anime.retry": "Повторить",
    "anime.about": "Описание",
    "anime.dub": "Озвучка",
    "anime.nowPlaying": "СЕЙЧАС",
    "anime.status": "Статус",
    "anime.score": "Оценка",
    "anime.type": "Тип",
    "anime.ageRating": "Возрастной рейтинг",
    "anime.releaseDate": "Релиз",
    "anime.duration": "Длительность",
    "anime.unknown": "Неизвестно",
    "anime.notAvailable": "Нет данных",
    "anime.noCover": "БЕЗ ОБЛОЖКИ",
    "anime.episodes": "Эпизоды",
    "anime.noEpisodes": "Эпизоды не найдены.",
    "anime.episodeNumber": "Эпизод #{{number}}",
    "anime.play": "СМОТРЕТЬ",
    "anime.playback": "Плеер",
    "anime.playerHint":
      "Выбирай серию, озвучку и качество прямо на странице тайтла.",
    "anime.selectEpisode": "Серия",
    "anime.selectVoice": "Озвучка / Сабы",
    "anime.selectQuality": "Качество",
    "anime.noPlayers": "Для этой серии пока нет доступных дорожек.",
    "anime.noQualities": "Для выбранной дорожки нет вариантов качества.",
    "anime.loadingStream": "Подготавливаем поток...",
    "anime.playbackUnavailable": "Для этого выбора поток недоступен.",
    "anime.openSelector": "Открыть список",
    "anime.relatedAnime": "Связанное",
    "anime.fullscreen": "Полный экран",
    "player.nowPlaying": "Сейчас играет",
    "player.missingEpisodeId": "Отсутствует id эпизода",
    "player.source": "Источник",
    "player.appleTracks": "Apple треки",
    "player.loading": "Подготавливаем поток...",
    "player.error": "Воспроизведение недоступно",
    "player.retry": "Повторить",
    "player.streamUnavailable": "URL потока недоступен для этого эпизода.",
    "player.playbackFailed": "Ошибка воспроизведения этого источника.",
    "player.source.none": "нет",
    "player.source.proxy": "прокси",
    "player.source.direct": "прямой",
    "anime.tracks": "Дорожки: {{count}}",
    "anime.untitled": "Без названия",
    "anime.unknownRelation": "Связанный тайтл",
    "anime.unknownPlayer": "Неизвестно",
    "anime.unknownTeam": "Неизвестная команда",
    "anime.unknownTranslation": "Неизвестно",
    "anime.episodeLabel": "Эп {{number}}",
    "anime.unknownEpisode": "Эпизод",
    "anime.episodeFallbackTitle": "Эпизод {{number}}",
    "anime.discovering": "Поиск аниме...",
    "anime.retryIn": "Повтор через {{seconds}}с",
    "anime.showMore": "Читать далее",
    "anime.showLess": "Свернуть",
    "anime.openOnShikimori": "Shikimori",
    "anime.openOnAniList": "AniList",
    "anime.sourceManga": "Источник",
    "anime.externalLinks": "Ссылки",
    "anime.externalLinkUnavailable":
      "Не удалось открыть ссылку на этом устройстве.",
    "anime.downloadEpisode": "Скачать эпизод",
    "anime.downloadQueued": "Добавлено в очередь загрузок",
    "anime.downloadingEpisode": "Загрузка… {{percent}}",
    "anime.downloadedEpisode": "Доступно оффлайн",
    "anime.downloadFailed": "Ошибка загрузки. Повтори.",
    "anime.selectAll": "Выбрать все",
    "anime.deselectAll": "Снять все",
    "account.signIn": "Войти",
    "account.signUp": "Регистрация",
    "account.profile": "Аккаунт",
    "account.signInHint":
      "Войди, чтобы закладки и история синхронизировались на всех устройствах.",
    "account.signUpHint": "Создай аккаунт, чтобы сохранять прогресс в облаке.",
    "account.emailPlaceholder": "Email",
    "account.passwordPlaceholder": "Пароль",
    "account.fillAllFields": "Заполни все поля.",
    "account.loginError": "Ошибка входа. Проверь email и пароль.",
    "account.registerError": "Ошибка регистрации. Попробуй ещё раз.",
    "account.noAccount": "Нет аккаунта?",
    "account.hasAccount": "Уже есть аккаунт?",
    "account.notConnected":
      "Supabase ещё не подключён — добавь API ключи для включения авторизации.",
    "account.signedInAs": "Вход выполнен: {{email}}",
    "account.signOut": "Выйти",
    "account.checkEmail": "Проверь почту, чтобы подтвердить регистрацию.",
    "anime.download": "Скачать",
    "anime.addBookmark": "В закладки",
    "anime.removeBookmark": "Убрать из закладок",
    "library.noBookmarksBody":
      "Нажми на иконку закладки на странице аниме, чтобы сохранить его здесь.",
    "library.clearBookmarksTitle": "Очистить закладки",
    "library.clearBookmarksBody": "Удалить все закладки с этого устройства?",
    "library.clearBookmarksAction": "Очистить",
    "errors.requestFailed": "Ошибка запроса ({{status}})",
    "errors.requestTimeout": "Время ожидания запроса истекло ({{seconds}}с)",
  },
} as const;

type TranslationKey = keyof (typeof translations)["en"];

type I18nContextValue = {
  language: AppLanguage;
  setLanguage: (language: AppLanguage) => void;
  applyCloudLanguage: (language: AppLanguage) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>("en");

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((value) => {
        if (value === "ru" || value === "en") {
          setLanguageState(value);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchCloudSettings().then((cloud) => {
      if (!cloud) return;
      setLanguageState(cloud.language);
      AsyncStorage.setItem(STORAGE_KEY, cloud.language).catch(() => {});
    }).catch(() => {});
  }, []);

  const setLanguage = useCallback((nextLanguage: AppLanguage) => {
    setLanguageState(nextLanguage);
    AsyncStorage.setItem(STORAGE_KEY, nextLanguage).catch(() => {});
    void AsyncStorage.multiGet(['app_theme_mode', 'app_accent_hue']).then(([[, mode], [, hue]]) => {
      const themeMode = mode === 'light' || mode === 'dark' ? mode : 'system';
      const accentHue = Number(hue);
      void pushSettingsToCloud({ themeMode, accentHue: Number.isFinite(accentHue) ? accentHue : 258, language: nextLanguage });
    });
  }, []);

  const applyCloudLanguage = useCallback((nextLanguage: AppLanguage) => {
    setLanguageState(nextLanguage);
    AsyncStorage.setItem(STORAGE_KEY, nextLanguage).catch(() => {});
  }, []);

  const t = useCallback(
    (key: TranslationKey, params?: Record<string, string | number>) => {
      const template = String(
        translations[language][key] || translations.en[key] || key,
      );
      if (!params) return template;

      let output = template;
      for (const [name, value] of Object.entries(params)) {
        output = output.replaceAll(`{{${name}}}`, String(value));
      }
      return output;
    },
    [language],
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      setLanguage,
      applyCloudLanguage,
      t,
    }),
    [language, setLanguage, applyCloudLanguage, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return context;
}
