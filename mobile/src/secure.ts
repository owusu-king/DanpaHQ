/**
 * Secure storage wrapper.
 *
 * Tokens go in the Keychain / Android Keystore, never AsyncStorage. Shared
 * Android devices are common in this market - a phone borrowed to a family
 * member should not hand over a signed-in rental account with a payment method
 * attached.
 */

import * as SecureStore from "expo-secure-store";

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const secure = {
  async get(key: string): Promise<string | null> {
    return SecureStore.getItemAsync(key, OPTIONS);
  },
  async set(key: string, value: string): Promise<void> {
    await SecureStore.setItemAsync(key, value, OPTIONS);
  },
  async clear(key: string): Promise<void> {
    await SecureStore.deleteItemAsync(key, OPTIONS);
  },
};
