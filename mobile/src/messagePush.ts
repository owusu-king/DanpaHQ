/** Native-only push. Browser builds keep using the existing inbox. */
export async function registerMessagePush(_requestPermission = false): Promise<boolean> {
  return false;
}

export function MessagePush(_props: { userId: string | null }) {
  return null;
}
