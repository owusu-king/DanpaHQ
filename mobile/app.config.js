/** Public app configuration; maps use local Leaflet and configurable HTTPS tiles. */
/* global __dirname */
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { parseEnv } = require("node:util");
module.exports = ({ config }) => {
  let local = {};
  try { local = parseEnv(readFileSync(resolve(__dirname, "../.env"), "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  // Only public OAuth client IDs enter extra; never copy the environment wholesale.
  const webClientId = process.env.GOOGLE_OAUTH_CLIENT_ID
    || process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || local.GOOGLE_OAUTH_CLIENT_ID
    || local.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || "";
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || local.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || "";
  const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID || local.EXPO_PUBLIC_EAS_PROJECT_ID || config.extra?.eas?.projectId;
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON || local.GOOGLE_SERVICES_JSON;
  const googleServicesPlist = process.env.GOOGLE_SERVICES_PLIST || local.GOOGLE_SERVICES_PLIST;
  if (googleServicesFile) process.env.GOOGLE_SERVICES_JSON = googleServicesFile;
  return {
    ...config,
    android: { ...config.android, ...(googleServicesFile ? { googleServicesFile } : {}) },
    ios: { ...config.ios, ...(googleServicesPlist ? { googleServicesFile: googleServicesPlist } : {}) },
    plugins: [
      ...(config.plugins ?? []),
      "expo-dev-client",
      "./plugins/withReleaseSigning",
      ...(googleServicesPlist ? ["@react-native-firebase/app"] : []),
      ["expo-build-properties", { ios: {
        useFrameworks: "static",
        forceStaticLinking: ["RNFBApp", "RNFBMessaging"],
      } }],
      // Android uses autolinking and explicit webClientId; this plugin registers
      // the iOS callback scheme. No Firebase backend or Google refresh token is needed.
      ...(iosClientId ? [["react-native-nitro-google-signin", { iosUrlScheme: iosClientId.split(".").reverse().join(".") }]] : []),
    ],
    extra: {
      ...config.extra,
      ...(projectId ? { eas: { ...config.extra?.eas, projectId } } : {}),
      mapTiles: {
        url: process.env.EXPO_PUBLIC_MAP_TILE_URL || local.EXPO_PUBLIC_MAP_TILE_URL,
        attribution: process.env.EXPO_PUBLIC_MAP_TILE_ATTRIBUTION || local.EXPO_PUBLIC_MAP_TILE_ATTRIBUTION,
        attributionUrl: process.env.EXPO_PUBLIC_MAP_TILE_ATTRIBUTION_URL || local.EXPO_PUBLIC_MAP_TILE_ATTRIBUTION_URL,
      },
      googleSignIn: { webClientId, iosClientId },
    },
  };
};
