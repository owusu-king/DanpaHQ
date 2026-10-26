"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { Icon, type IconName } from "@/components/portal/icons";
import { isAborted } from "@/lib/api";
import type { ExploreArea } from "@/lib/exploreQuery";
import {
  newPlacesSession,
  resolvePlace,
  suggestPlaces,
  type PlaceKind,
  type PlaceSuggestion,
  type ResolvedPlace,
} from "@/lib/places";

/**
 * The location field: type a name, choose a place.
 *
 * Suggestions come from Danpa HQ's API, which asks the location provider on the
 * field's behalf (ADR 0034), and each keystroke withdraws the request before
 * it. One search is one Places session: the token is made with the first
 * request, carried by every one after it, and spent by resolving the choice —
 * so a provider that prices sessions prices a search, not every letter. What
 * gets chosen is a place with a centre and a box, never the text that was typed.
 * Enter takes the highlighted suggestion; with none, the text is searched as
 * text, and the field says so first.
 */

const KIND_ICON: Record<PlaceKind, IconName> = { area: "map", landmark: "landmark", address: "pin" };
const KIND_LABEL: Record<PlaceKind, string> = { area: "Area", landmark: "Place", address: "Address" };

const RECENT_KEY = "danpahq:recent-places:v2";
const RECENT_LIMIT = 5;
/** A recent place holds a provider's coordinates, which may be kept for thirty days at most. */
const RECENT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** Recent answers by query, so backspacing through a word costs no requests. */
const answered = new Map<string, { attribution: string | null; suggestions: PlaceSuggestion[] }>();

type RecentPlace = { place: ResolvedPlace; savedAt: number };

function isRecent(value: unknown): value is RecentPlace {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<RecentPlace>;
  return (
    typeof row.savedAt === "number" &&
    Date.now() - row.savedAt < RECENT_MAX_AGE_MS &&
    typeof row.place?.reference === "string" &&
    typeof row.place.display_name === "string" &&
    Boolean(row.place.bounds)
  );
}

function readRecentRows(): RecentPlace[] {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(stored) ? stored.filter(isRecent).slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

export function rememberPlace(place: ResolvedPlace) {
  try {
    const others = readRecentRows().filter(
      (row) => row.place.provider !== place.provider || row.place.reference !== place.reference,
    );
    const next = [{ place, savedAt: Date.now() }, ...others].slice(0, RECENT_LIMIT);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // A private window or a full quota only loses the shortcut, never the search.
  }
}

function highlight(name: string, typed: string): ReactNode {
  const needle = typed.trim().toLocaleLowerCase("en-GH");
  const at = needle ? name.toLocaleLowerCase("en-GH").indexOf(needle) : -1;
  if (at < 0) return name;
  return (
    <>
      {name.slice(0, at)}
      <mark>{name.slice(at, at + needle.length)}</mark>
      {name.slice(at + needle.length)}
    </>
  );
}

type Row = { key: string; name: string; context: string; kind: PlaceKind; choose: () => void };

export function PlaceSearch({
  area,
  text,
  onChoosePlace,
  onSubmitText,
  onClear,
  label = "Search by location or property",
}: {
  area: ExploreArea | null;
  /** Free text searched without choosing a place, or a legacy locality name. */
  text: string;
  onChoosePlace: (place: ResolvedPlace) => void;
  onSubmitText: (text: string) => void;
  onClear: () => void;
  label?: string;
}) {
  const committed = area?.name ?? text;
  const [draft, setDraft] = useState(committed);
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [attribution, setAttribution] = useState<string | null>(null);
  const [recent, setRecent] = useState<ResolvedPlace[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [resolveFailed, setResolveFailed] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  /** The Places session this search's requests share; none until a request goes. */
  const session = useRef<string | null>(null);
  const choosing = useRef<AbortController | null>(null);
  const listId = useId();

  // A choice made elsewhere — a restored URL, a cleared filter — is shown here.
  useEffect(() => { setDraft(committed); }, [committed]);
  useEffect(() => () => choosing.current?.abort(), []);

  const typed = draft.trim();
  const editing = typed !== committed.trim();

  useEffect(() => {
    if (!editing || typed.length < 2) {
      setSuggestions([]);
      setLoading(false);
      setFailed(false);
      return;
    }
    const key = typed.toLocaleLowerCase("en-GH");
    const cached = answered.get(key);
    if (cached) {
      setSuggestions(cached.suggestions);
      setAttribution(cached.attribution);
      setHighlighted(cached.suggestions.length ? 0 : -1);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(() => {
      session.current ??= newPlacesSession();
      suggestPlaces(typed, session.current, controller.signal)
        .then((answer) => {
          answered.set(key, { attribution: answer.attribution, suggestions: answer.suggestions });
          if (answered.size > 60) answered.delete(answered.keys().next().value as string);
          setSuggestions(answer.suggestions);
          setAttribution(answer.attribution);
          setHighlighted(answer.suggestions.length ? 0 : -1);
          setFailed(false);
          setLoading(false);
        })
        .catch((cause) => {
          if (isAborted(cause)) return;
          setSuggestions([]);
          setFailed(true);
          setLoading(false);
        });
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [typed, editing]);

  function commit(place: ResolvedPlace) {
    rememberPlace(place);
    setOpen(false);
    setHighlighted(-1);
    // The field shows the place once the search holds it; setting the text here
    // first would read as new typing and ask for suggestions again.
    onChoosePlace(place);
  }

  async function choose(row: PlaceSuggestion) {
    choosing.current?.abort();
    const controller = new AbortController();
    choosing.current = controller;
    setResolving(true);
    setResolveFailed(false);
    try {
      const place = await resolvePlace(row, session.current, controller.signal);
      // Resolving spends the session; the next search starts another.
      session.current = null;
      commit(place);
    } catch (cause) {
      if (isAborted(cause)) return;
      setResolveFailed(true);
      setOpen(true);
    } finally {
      if (choosing.current === controller) {
        choosing.current = null;
        setResolving(false);
      }
    }
  }

  const showingRecent = open && !editing && !typed && recent.length > 0;
  const rows: Row[] = showingRecent
    ? recent.map((place) => ({
        key: `${place.provider}:${place.reference}`,
        name: place.display_name,
        context: "",
        kind: place.kind,
        choose: () => commit(place),
      }))
    : editing
      ? suggestions.map((row) => ({
          key: `${row.provider}:${row.reference}`,
          name: row.name,
          context: row.context,
          kind: row.kind,
          choose: () => void choose(row),
        }))
      : [];
  const listOpen = open && (showingRecent || (editing && typed.length >= 2));
  const activeRow = rows[highlighted];

  const status = useMemo(() => {
    if (!listOpen || showingRecent) return "";
    if (resolving) return "Opening that place…";
    if (resolveFailed) return "That place did not open. Choose it again, or press Enter to search the text.";
    if (loading && !suggestions.length) return "Looking for places…";
    if (failed) return "Places are not loading. Press Enter to search this text.";
    if (!suggestions.length) return `No place called “${typed}”. Press Enter to search listings for it.`;
    return "";
  }, [listOpen, showingRecent, resolving, resolveFailed, loading, suggestions.length, failed, typed]);

  function submit() {
    if (activeRow) return activeRow.choose();
    if (!typed) {
      onClear();
      return;
    }
    setOpen(false);
    // Text searched as text ends this search without a place; the next is a new session.
    session.current = null;
    onSubmitText(typed);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!rows.length) return;
      event.preventDefault();
      setOpen(true);
      const last = rows.length - 1;
      setHighlighted((current) => event.key === "ArrowDown"
        ? (current >= last ? 0 : current + 1)
        : (current <= 0 ? last : current - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      submit();
    } else if (event.key === "Escape") {
      if (listOpen) {
        // The first Escape closes the list; the text stays until cleared.
        event.preventDefault();
        setOpen(false);
      } else if (editing) {
        event.preventDefault();
        setDraft(committed);
      }
    }
  }

  return (
    <div
      className="explore-search explore-place-search"
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setOpen(false);
        // Leaving the field without choosing puts back what is actually searched.
        if (editing && !resolving) setDraft(committed);
      }}
    >
      <Icon name={area ? "pin" : "explore"} />
      <label>
        <span className="sr-only">{label}</span>
        <input
          ref={input}
          type="search"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={listOpen}
          aria-controls={listId}
          aria-activedescendant={listOpen && activeRow ? `${listId}-${highlighted}` : undefined}
          autoComplete="off"
          enterKeyHint="search"
          spellCheck={false}
          value={draft}
          onChange={(event) => { setDraft(event.target.value); setOpen(true); setResolveFailed(false); }}
          onFocus={() => { setRecent(readRecentRows().map((row) => row.place)); setOpen(true); }}
          onKeyDown={onKeyDown}
          placeholder="Search area, town or landmark…"
        />
      </label>
      {loading || resolving ? <span className="explore-search-spinner" aria-hidden="true" /> : null}
      {draft ? (
        <button
          type="button"
          className="explore-search-clear"
          aria-label="Clear search"
          onClick={() => {
            choosing.current?.abort();
            session.current = null;
            setDraft("");
            setSuggestions([]);
            onClear();
            input.current?.focus();
          }}
        ><Icon name="close" /></button>
      ) : null}
      {listOpen ? (
        <div className="explore-suggestions">
          {showingRecent ? <p className="explore-suggestions-heading">Recent searches</p> : null}
          <ul id={listId} role="listbox" aria-label={showingRecent ? "Recent searches" : "Places"}>
            {rows.map((row, index) => (
              <li
                key={row.key}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === highlighted}
                className={index === highlighted ? "is-highlighted" : undefined}
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => { if (index !== highlighted) setHighlighted(index); }}
                onClick={row.choose}
              >
                <span className={`explore-suggestion-mark is-${row.kind}`}>
                  <Icon name={showingRecent ? "clock" : KIND_ICON[row.kind]} />
                </span>
                <span className="explore-suggestion-copy">
                  <strong>{showingRecent ? row.name : highlight(row.name, typed)}</strong>
                  {row.context ? <span>{row.context}</span> : null}
                </span>
                <span className="explore-suggestion-kind">{KIND_LABEL[row.kind]}</span>
              </li>
            ))}
          </ul>
          {status ? <p className="explore-suggestions-status" role="status">{status}</p> : null}
          {/* Google's suggestions, shown where there may be no Google map, carry its name. */}
          {!showingRecent && attribution === "google" && rows.length ? (
            <p className="explore-suggestions-attribution">
              <span className="sr-only">Place suggestions from </span>Google Maps
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
