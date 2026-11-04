// expo-notifications owns Android's FCM service and token lifecycle.
module.exports = {
  dependencies: {
    "@react-native-firebase/app": { platforms: { android: null } },
    "@react-native-firebase/messaging": { platforms: { android: null } },
  },
};
