const { withAppBuildGradle } = require("expo/config-plugins");

module.exports = (config) => withAppBuildGradle(config, (mod) => {
  const directive = 'apply from: "../../plugins/release-signing.gradle"';
  // Expo's generated template signs release builds with its debug key.
  mod.modResults.contents = mod.modResults.contents.replace(
    /(release\s*\{[^}]*?)signingConfig signingConfigs\.debug/,
    "$1// Release credentials are supplied by the signing script below.",
  );
  if (!mod.modResults.contents.includes(directive)) {
    mod.modResults.contents += `\n${directive}\n`;
  }
  return mod;
});
