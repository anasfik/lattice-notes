/**
 * The bookmarks of the vault.
 *
 * The panel lists the bookmarks in groups and lets the reader open one or take
 * it off. Every control is a button, so the panel is operable from the
 * keyboard alone; there is no drag and drop that only a mouse could reach.
 *
 * The list is empty until a note is bookmarked, and the panel says so instead
 * of showing an empty list.
 */

import { useId, useMemo } from 'react';

import { groupBookmarks } from '../domain/bookmarks';
import type { Bookmark } from '../domain/bookmarks';
import Icon from './Icon';

export interface BookmarksPanelProps {
  /** The bookmarks of the vault on the screen. */
  bookmarks: Bookmark[];
  /** True when the note on the screen is a bookmark already. */
  activeBookmarked: boolean;
  /** True when there is a note on the screen. */
  hasActiveNote: boolean;
  /** Adds the note on the screen to the bookmarks, or takes it off. */
  onToggleActive(): void;
  /** Opens the note a bookmark points at. */
  onOpen(bookmark: Bookmark): void;
  /** Takes a bookmark off. */
  onRemove(bookmark: Bookmark): void;
  /** True while the bookmarks are being read. */
  loading?: boolean;
  onRetry?: () => void;
  /** Why the bookmarks cannot be shown, or nothing when they can. */
  error?: string | null;
}

export default function BookmarksPanel({
  bookmarks,
  activeBookmarked,
  hasActiveNote,
  onToggleActive,
  onOpen,
  onRemove,
  loading = false,
  onRetry,
  error = null,
}: BookmarksPanelProps) {
  const titleId = useId();
  const groups = useMemo(() => groupBookmarks(bookmarks), [bookmarks]);

  return (
    <section className="bookmarks" aria-labelledby={titleId}>
      <div className="bookmarks__header">
        <h2 className="bookmarks__title" id={titleId}>
          <Icon name="link" size={14} />
          Bookmarks
        </h2>
        <button
          type="button"
          className="bookmarks__add"
          disabled={!hasActiveNote || loading || !!error}
          onClick={onToggleActive}
        >
          {activeBookmarked ? 'Remove this bookmark' : 'Bookmark this note'}
        </button>
      </div>

      {loading ? (
        <p className="bookmarks__empty">The bookmarks are being read…</p>
      ) : error ? (
        <div className="bookmarks__empty">
          <p>{error}</p>
          {onRetry && (
            <button type="button" className="bookmarks__retry" onClick={onRetry}>
              Retry bookmarks
            </button>
          )}
        </div>
      ) : bookmarks.length === 0 ? (
        <p className="bookmarks__empty">
          No bookmarks yet. Bookmark a note to reach it from here.
        </p>
      ) : (
        <ul className="bookmarks__groups" role="list">
          {[...groups.entries()].map(([group, entries]) => (
            <li key={group} className="bookmarks__group">
              <h3 className="bookmarks__group-name">{group}</h3>
              <ul className="bookmarks__list" role="list">
                {entries.map((bookmark) => (
                  <li key={bookmark.id} className="bookmarks__item">
                    <button
                      type="button"
                      className="bookmarks__open"
                      onClick={() => onOpen(bookmark)}
                    >
                      {bookmark.title}
                    </button>
                    <button
                      type="button"
                      className="bookmarks__remove"
                      aria-label={`Remove the bookmark of ${bookmark.title}`}
                      onClick={() => onRemove(bookmark)}
                    >
                      <Icon name="close" size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
