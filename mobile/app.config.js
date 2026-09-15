/**
 * Google Maps keys for native builds (ADR 0034), from the environment.
 *
 * app.json stays the configuration; this adds only what must not be committed.
 * The Android key is restricted in Google Cloud to this app's package and signing
 * certificate, and the iOS key to its bundle ID, so the binary carrying them is
 * how Google intends them to be used. Expo Go ignores both: it carries its own.
 *
 *   GOOGLE_MAPS_ANDROID_API_KEY=… GOOGLE_MAPS_IOS_API_KEY=… npx expo run:android
 */
module.exports = ({ config }) => {
  const android = process.env.GOOGLE_MAPS_ANDROID_API_KEY ?? "";
  const ios = process.env.GOOGLE_MAPS_IOS_API_KEY ?? "";
  return {
    ...config,
    android: {
      ...config.android,
      config: { ...config.android?.config, ...(android ? { googleMaps: { apiKey: android } } : {}) },
    },
    ios: {
      ...config.ios,
      config: { ...config.ios?.config, ...(ios ? { googleMapsApiKey: ios } : {}) },
    },
    extra: {
      ...config.extra,
      // Whether this build can draw a map. The keys themselves never reach JavaScript.
      googleMaps: { android: Boolean(android), ios: Boolean(ios) },
    },
  };
};
