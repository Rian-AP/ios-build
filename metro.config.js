const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Fix for @supabase/supabase-js ws/stream module issue with React Native
// https://github.com/supabase/supabase-js/issues/1400
config.resolver.unstable_enablePackageExports = false;

module.exports = config;
