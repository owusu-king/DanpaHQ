import { useLayoutEffect, useState } from "react";
import { PanResponder, type PanResponderCallbacks } from "react-native";

type GestureHandlers = Pick<PanResponderCallbacks,
  | "onStartShouldSetPanResponder"
  | "onMoveShouldSetPanResponder"
  | "onMoveShouldSetPanResponderCapture"
  | "onPanResponderGrant"
  | "onPanResponderMove"
  | "onPanResponderRelease"
  | "onPanResponderTerminate"
  | "onPanResponderTerminationRequest"
>;

function createResponder() {
  let handlers: GestureHandlers = {};
  const { panHandlers } = PanResponder.create({
    onStartShouldSetPanResponder: (e, g) => handlers.onStartShouldSetPanResponder?.(e, g) ?? false,
    onMoveShouldSetPanResponder: (e, g) => handlers.onMoveShouldSetPanResponder?.(e, g) ?? false,
    onMoveShouldSetPanResponderCapture: (e, g) => handlers.onMoveShouldSetPanResponderCapture?.(e, g) ?? false,
    onPanResponderGrant: (e, g) => handlers.onPanResponderGrant?.(e, g),
    onPanResponderMove: (e, g) => handlers.onPanResponderMove?.(e, g),
    onPanResponderRelease: (e, g) => handlers.onPanResponderRelease?.(e, g),
    onPanResponderTerminate: (e, g) => handlers.onPanResponderTerminate?.(e, g),
    onPanResponderTerminationRequest: (e, g) => handlers.onPanResponderTerminationRequest?.(e, g) ?? true,
  });

  return {
    panHandlers,
    update(next: GestureHandlers) {
      handlers = next;
    },
  };
}

/** Keep native gesture tracking stable while dispatching to the committed render's handlers. */
export function usePanResponder(handlers: GestureHandlers) {
  const [responder] = useState(createResponder);
  useLayoutEffect(() => {
    responder.update(handlers);
    return () => responder.update({});
  }, [handlers, responder]);
  return responder.panHandlers;
}
