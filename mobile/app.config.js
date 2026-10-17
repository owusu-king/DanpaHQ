/**
 * Android Google Maps key for native builds (ADR 0034), from the environment.
 *
 * app.json stays the configuration; the maps plugin writes a Gradle placeholder
 * into the native app during prebuild. Expo Go uses its own map configuration.
 * The Android key is restricted in Google Cloud to this app's package and signing
 * certificate. iOS uses Apple Maps and needs no Google Maps key.
 *
 * Local builds also accept the key from the repository-root .env file.
 */
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { parseEnv } = require("node:util");
const { withAppBuildGradle } = require("expo/config-plugins");

// The manifest merger fills ${GOOGLE_MAPS_ANDROID_API_KEY} only from a Gradle
// manifest placeholder, never from the environment, so a bare ./gradlew build
// failed. Gradle reads the key the same way this file does.
const MAPS_KEY_GRADLE = `
// Android Google Maps key (ADR 0034): the environment, else the repository-root .env.
def googleMapsAndroidApiKey() {
    def fromEnv = System.getenv('GOOGLE_MAPS_ANDROID_API_KEY')
    if (fromEnv) return fromEnv
    def dotEnv = rootProject.file('../../.env')
    if (!dotEnv.exists()) return ''
    def line = dotEnv.readLines().find { it.startsWith('GOOGLE_MAPS_ANDROID_API_KEY=') }
    return line ? line.substring('GOOGLE_MAPS_ANDROID_API_KEY='.length()).trim().replaceAll(/^["']|["']$/, '') : ''
}
`;

function withMapsKeyPlaceholder(config) {
  return withAppBuildGradle(config, (mod) => {
    if (mod.modResults.contents.includes("googleMapsAndroidApiKey()")) return mod;
    mod.modResults.contents = mod.modResults.contents
      .replace(/^android \{/m, `${MAPS_KEY_GRADLE}\nandroid {`)
      .replace(
        /defaultConfig \{\n/,
        "defaultConfig {\n        manifestPlaceholders += [GOOGLE_MAPS_ANDROID_API_KEY: googleMapsAndroidApiKey()]\n",
      );
    return mod;
  });
}

function localAndroidMapsKey() {
  try {
    return parseEnv(readFileSync(resolve(__dirname, "../.env"), "utf8")).GOOGLE_MAPS_ANDROID_API_KEY ?? "";
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

module.exports = ({ config }) => {
  const android = process.env.GOOGLE_MAPS_ANDROID_API_KEY || localAndroidMapsKey();
  // expo run:android launches Gradle as a child process of this configuration.
  if (android) process.env.GOOGLE_MAPS_ANDROID_API_KEY = android;
  return withMapsKeyPlaceholder({
    ...config,
    plugins: [
      ...(config.plugins ?? []),
      ...(android ? [["react-native-maps", { androidGoogleMapsApiKey: "${GOOGLE_MAPS_ANDROID_API_KEY}" }]] : []),
    ],
    extra: {
      ...config.extra,
      // Whether Android can draw a map. The key itself never reaches JavaScript.
      googleMaps: { android: Boolean(android) },
    },
  });
};
