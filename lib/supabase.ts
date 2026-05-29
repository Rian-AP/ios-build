import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = (
  process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://eoivcawwunyqhpkztgdt.supabase.co'
).trim();
const SUPABASE_KEY = (
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVvaXZjYXd3dW55cWhwa3p0Z2R0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxMzEwMzMsImV4cCI6MjA5NDcwNzAzM30.zuyARszQTvzyGIT6jDpGA0uRJiuLmolNUinHwsJDvJw'
).trim();

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY);

export const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
      global: {
        fetch: fetch.bind(globalThis),
      },
    })
  : null;

