/** The screens the auth dialog can show, and what each flow is handed. */

export type AuthView = "sign-in" | "register" | "forgot-password" | "welcome";

export type AuthParams = {
  /** The side asked for: "I own or manage property" rides in as provider. */
  workspace?: "tenant" | "provider";
  /** A same-origin path to finish on, when the person was in the middle of something. */
  next?: string | null;
  /** A number already typed elsewhere, so it is not typed twice. */
  phone?: string;
};

export type AuthFlowProps = {
  params: AuthParams;
  /** Show another auth screen in the same dialog. */
  go: (view: AuthView, params?: AuthParams) => void;
  /** Shut the dialog and stay on the page. */
  close: () => void;
  /** Shut the dialog and go somewhere: the end of a flow. */
  land: (route: string) => void;
};

/** The address that opens a view from outside the app (an email, a bookmark, a redirect). */
export function authHref(view: AuthView, params: AuthParams = {}): string {
  const query = new URLSearchParams();
  if (params.workspace) query.set("workspace", params.workspace);
  if (params.next) query.set("next", params.next);
  if (params.phone) query.set("phone", params.phone);
  return query.size ? `/${view}?${query.toString()}` : `/${view}`;
}
