import { EntryRedirect } from "@/components/EntryRedirect";
import { FrontDoor } from "@/components/landing/FrontDoor";

/**
 * The front door, on one screen (owner, 2026-09-29).
 *
 * One question, asked plainly: are you looking for a place, or managing one?
 * No cards, no feature lists — a headline, a line of reassurance, two ways in,
 * and the three checks that make the reassurance true. Browsing without an
 * account is in the navbar ("Find Property"). The page is `FrontDoor`, which
 * the sign-in modal also opens over.
 */
export default function Page() {
  return (
    <>
      <EntryRedirect />
      <FrontDoor />
    </>
  );
}
