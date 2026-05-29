import AsyncStorage from '@react-native-async-storage/async-storage';

import type { AnimeDetails } from '@/lib/api';

const KEY = 'offline_anime_details_v1';

export async function saveOfflineAnimeDetails(slug: string, details: AnimeDetails): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const map: Record<string, unknown> = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    map[slug] = details;
    await AsyncStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // ignore write errors
  }
}

export async function getOfflineAnimeDetails(slug: string): Promise<AnimeDetails | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, unknown>;
    return (map[slug] as AnimeDetails) ?? null;
  } catch {
    return null;
  }
}

export async function removeOfflineAnimeDetails(slug: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return;
    const map = JSON.parse(raw) as Record<string, unknown>;
    delete map[slug];
    await AsyncStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}
