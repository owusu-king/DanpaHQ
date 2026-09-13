"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { Icon, type IconName } from "@/components/portal/icons";
import { isAborted } from "@/lib/api";
import { searchPlaces, type Place, type PlaceKind } from "@/lib/places";

/**
 * The location field: type a name, choose a place.
 *
 * Suggestions arrive while somebody types, and each keystroke withdraws the
 * request before it. What gets chosen is a place — a slug, a centre, a box — so
 * the search never depends on how the name was spelled. Typing and pressing
 * Enter without choosing takes the best suggestion; with none, the text is
 * searched as text, and the field says so.
 */

const KIND_ICON: Record<PlaceKind, IconName> = {
  region: "map",
  district: "map",
  city: "city",
  town: "city",
  suburb: "pin",
  neighbourhood: "pin",
  village: "pin",
  landmark: "landmark",
};

const RECENT_KEY = "rooomly:recent-places";
const RECENT_LIMIT = 5;
/** Recent answers by query, so backspacing through a word costs no requests. */
const answered = new Map<string, Place[]>();

function readRecent(): Place[] {
  try {
    const stored = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(stored) ? stored.filter((row) => row && typeof row.slug === "string").slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

export function rememberPlace(place: Place) {
  try {
    const next = [place, ...readRecent().filter((row) => row.slug !== place.slug)].slice(0, RECENT_LIMIT);
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

export function PlaceSearch({
  place,
  text,
  onChoosePlace,
  onSubmitText,
  onClear,
  variant = "tray",
  label = "Search by location or property",
}: {
  place: Place | null;
  /** Free text searched without choosing a place, or a legacy locality name. */
  text: string;
  onChoosePlace: (place: Place) => void;
  onSubmitText: (text: string) => void;
  onClear: () => void;
  variant?: "tray" | "map";
  label?: string;
}) {
  const committed = place?.display_name ?? text;
  const [draft, setDraft] = useState(committed);
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Place[]>([]);
  const [recent, setRecent] = useState<Place[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  // A choice made elsewhere — a restored URL, a cleared filter — is shown here.
  useEffect(() => { setDraft(committed); }, [committed]);

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
      setSuggestions(cached);
      setHighlighted(cached.length ? 0 : -1);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(() => {
      searchPlaces(typed, controller.signal)
        .then((rows) => {
          answered.set(key, rows);
          if (answered.size > 60) answered.delete(answered.keys().next().value as string);
          setSuggestions(rows);
          setHighlighted(rows.length ? 0 : -1);
          setFailed(false);
          setLoading(false);
        })
        .catch((cause) => {
          if (isAborted(cause)) return;
          setSuggestions([]);
          setFailed(true);
          setLoading(false);
        });
    }, 120);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [typed, editing]);

  const showingRecent = open && !editing && !typed && recent.length > 0;
  const rows = showingRecent ? recent : editing ? suggestions : [];
  const listOpen = open && (showingRecent || (editing && typed.length >= 2));
  const activeRow = rows[highlighted];

  const status = useMemo(() => {
    if (!listOpen || showingRecent) return "";
    if (loading && !suggestions.length) return "Looking for places…";
    if (failed) return "Places are not loading. Press Enter to search this text.";
    if (!suggestions.length) return `No area called “${typed}”. Press Enter to search listings for it.`;
    return "";
  }, [listOpen, showingRecent, loading, suggestions.length, failed, typed]);

  function choose(row: Place) {
    rememberPlace(row);
    setOpen(false);
    setHighlighted(-1);
    setDraft(row.display_name);
    onChoosePlace(row);
  }

  function submit() {
    if (activeRow) return choose(activeRow);
    if (!typed) {
      onClear();
      return;
    }
    setOpen(false);
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
      className={`explore-search explore-place-search is-${variant}`}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setOpen(false);
        // Leaving the field without choosing puts back what is actually searched.
        if (editing) setDraft(committed);
      }}
    >
      <Icon name={place ? KIND_ICON[place.kind] : "explore"} />
      <label>
        <span className="sr-only">{label}</span>
        <input
          ref={input}
          type="search"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={listOpen}
          aria-controls={listId}
          aria-activedescendant={listOpen && activeRow ? `${listId}-${activeRow.slug}` : undefined}
          autoComplete="off"
          enterKeyHint="search"
          spellCheck={false}
          value={draft}
          onChange={(event) => { setDraft(event.target.value); setOpen(true); }}
          onFocus={() => { setRecent(readRecent()); setOpen(true); }}
          onKeyDown={onKeyDown}
          placeholder="Search area, town or landmark…"
        />
      </label>
      {loading ? <span className="explore-search-spinner" aria-hidden="true" /> : null}
      {draft ? (
        <button
          type="button"
          className="explore-search-clear"
          aria-label="Clear search"
          onClick={() => {
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
          {rows.length ? (
            <ul id={listId} role="listbox" aria-label={showingRecent ? "Recent searches" : "Places"}>
              {rows.map((row, index) => (
                <li
                  key={row.slug}
                  id={`${listId}-${row.slug}`}
                  role="option"
                  aria-selected={index === highlighted}
                  className={index === highlighted ? "is-highlighted" : undefined}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseMove={() => { if (index !== highlighted) setHighlighted(index); }}
                  onClick={() => choose(row)}
                >
                  <span className={`explore-suggestion-mark is-${row.kind}`}>
                    <Icon name={showingRecent ? "clock" : KIND_ICON[row.kind]} />
                  </span>
                  <span className="explore-suggestion-copy">
                    <strong>{showingRecent ? row.name : highlight(row.name, typed)}</strong>
                    <span>{row.context}</span>
                  </span>
                  <span className="explore-suggestion-kind">{row.kind_label}</span>
                </li>
              ))}
            </ul>
          ) : (
            <ul id={listId} role="listbox" aria-label="Places" />
          )}
          {status ? <p className="explore-suggestions-status" role="status">{status}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
