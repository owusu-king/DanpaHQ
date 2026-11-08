import { usePathname, useRouter } from "expo-router";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { View } from "react-native";

import { BottomSheet } from "@/components/sheet/BottomSheet";
import { Button, space } from "@/components/ui";

const GuestSignIn = createContext<(next?: string) => void>(() => undefined);

/** Authentication is an explicit choice; dismissing keeps the browsing screen mounted. */
export function GuestSignInProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [next, setNext] = useState<string | null>(null);
  const close = () => setNext(null);
  const request = useCallback((destination?: string) => setNext(destination ?? pathname), [pathname]);
  return (
    <GuestSignIn.Provider value={request}>
      {children}
      <BottomSheet visible={next !== null} onClose={close} title="Sign in to continue" closeLabel="Keep browsing">
        <View style={{ gap: space[4], padding: space[4] }}>
          <Button label="Sign in" onPress={() => {
            const destination = next;
            close();
            router.push({ pathname: "/(auth)/sign-in", params: { next: destination ?? pathname } });
          }} />
          <Button label="Keep browsing" variant="quiet" onPress={close} />
        </View>
      </BottomSheet>
    </GuestSignIn.Provider>
  );
}

export const useGuestSignIn = () => useContext(GuestSignIn);
