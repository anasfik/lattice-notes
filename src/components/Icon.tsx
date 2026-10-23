/**
 * The icons of the product.
 *
 * The pictures are a small set of Lucide icons, copied from the upstream
 * files of lucide-static 1.60.0 without a change. Lucide is published under
 * the ISC licence; the licence and the list of the icons that are used are in
 * `src/components/icons/LUCIDE-LICENSE.txt` and in THIRD_PARTY_NOTICES.md.
 *
 * An icon decorates a name, it never carries one: the picture is hidden from
 * the reader, so the label beside it is the name of the control. The colour
 * is the colour of the text it stands in, so an icon follows the paper, the
 * ink and the copper of the surface it is on.
 */

import type { ReactNode } from 'react';

/** The icons the product uses. */
export type IconName =
  | 'actions'
  | 'add'
  | 'app-menu'
  | 'archive'
  | 'backlinks'
  | 'calendar'
  | 'close'
  | 'command-palette'
  | 'context-panel'
  | 'details'
  | 'disclosure'
  | 'export'
  | 'files'
  | 'fit'
  | 'flat'
  | 'folder'
  | 'graph'
  | 'import'
  | 'info'
  | 'link'
  | 'links'
  | 'move'
  | 'new-folder'
  | 'new-note'
  | 'next'
  | 'note'
  | 'notes-panel'
  | 'open-vault'
  | 'orbit'
  | 'previous'
  | 'read'
  | 'rename'
  | 'reset'
  | 'restore'
  | 'search'
  | 'settings'
  | 'shortcuts'
  | 'solid'
  | 'split'
  | 'tabs'
  | 'today'
  | 'trash'
  | 'undo'
  | 'vaults'
  | 'write'
  | 'zoom-in'
  | 'zoom-out';

/** The names of the icons, so a test can hold the set to the product. */
export const ICON_NAMES: IconName[] = [
  'actions',
  'add',
  'app-menu',
  'archive',
  'backlinks',
  'calendar',
  'close',
  'command-palette',
  'context-panel',
  'details',
  'disclosure',
  'export',
  'files',
  'fit',
  'flat',
  'folder',
  'graph',
  'import',
  'info',
  'link',
  'links',
  'move',
  'new-folder',
  'new-note',
  'next',
  'note',
  'notes-panel',
  'open-vault',
  'orbit',
  'previous',
  'read',
  'rename',
  'reset',
  'restore',
  'search',
  'settings',
  'shortcuts',
  'solid',
  'split',
  'tabs',
  'today',
  'trash',
  'undo',
  'vaults',
  'write',
  'zoom-in',
  'zoom-out',
];

/** The picture of every icon, as the upstream files draw it. */
const ICONS: Record<IconName, ReactNode> = {
  // more-horizontal.svg — Lucide (ISC), copied without a change.
  'actions': (
    <>
    <circle cx="12" cy="12" r="1" />
    <circle cx="19" cy="12" r="1" />
    <circle cx="5" cy="12" r="1" />
    </>
  ),
  // plus.svg — Lucide (ISC), copied without a change.
  'add': (
    <>
    <path d="M5 12h14" />
    <path d="M12 5v14" />
    </>
  ),
  // menu.svg — Lucide (ISC), copied without a change.
  'app-menu': (
    <>
    <path d="M4 5h16" />
    <path d="M4 12h16" />
    <path d="M4 19h16" />
    </>
  ),
  // archive.svg — Lucide (ISC), copied without a change.
  'archive': (
    <>
    <rect width="20" height="5" x="2" y="3" rx="1" />
    <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
    <path d="M10 12h4" />
    </>
  ),
  // corner-down-left.svg — Lucide (ISC), copied without a change.
  'backlinks': (
    <>
    <path d="M20 4v7a4 4 0 0 1-4 4H4" />
    <path d="m9 10-5 5 5 5" />
    </>
  ),
  // calendar.svg — Lucide (ISC), copied without a change.
  'calendar': (
    <>
    <path d="M8 2v3" />
    <path d="M16 2v3" />
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18" />
    </>
  ),
  // x.svg — Lucide (ISC), copied without a change.
  'close': (
    <>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
    </>
  ),
  // command.svg — Lucide (ISC), copied without a change.
  'command-palette': (
    <>
    <path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />
    </>
  ),
  // panel-right.svg — Lucide (ISC), copied without a change.
  'context-panel': (
    <>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M15 3v18" />
    </>
  ),
  // list.svg — Lucide (ISC), copied without a change.
  'details': (
    <>
    <path d="M3 5h.01" />
    <path d="M3 12h.01" />
    <path d="M3 19h.01" />
    <path d="M8 5h13" />
    <path d="M8 12h13" />
    <path d="M8 19h13" />
    </>
  ),
  // chevron-right.svg — Lucide (ISC), copied without a change.
  'disclosure': (
    <>
    <path d="m9 18 6-6-6-6" />
    </>
  ),
  // download.svg — Lucide (ISC), copied without a change.
  'export': (
    <>
    <path d="M12 15V3" />
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="m7 10 5 5 5-5" />
    </>
  ),
  // files.svg — Lucide (ISC), copied without a change.
  'files': (
    <>
    <path d="M15 2h-4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8" />
    <path d="M16.706 2.706A2.4 2.4 0 0 0 15 2v5a1 1 0 0 0 1 1h5a2.4 2.4 0 0 0-.706-1.706z" />
    <path d="M5 7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 1.732-1" />
    </>
  ),
  // maximize.svg — Lucide (ISC), copied without a change.
  'fit': (
    <>
    <path d="M8 3H5a2 2 0 0 0-2 2v3" />
    <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
    <path d="M3 16v3a2 2 0 0 0 2 2h3" />
    <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
    </>
  ),
  // square.svg — Lucide (ISC), copied without a change.
  'flat': (
    <>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    </>
  ),
  // folder.svg — Lucide (ISC), copied without a change.
  'folder': (
    <>
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </>
  ),
  // network.svg — Lucide (ISC), copied without a change.
  'graph': (
    <>
    <rect x="16" y="16" width="6" height="6" rx="1" />
    <rect x="2" y="16" width="6" height="6" rx="1" />
    <rect x="9" y="2" width="6" height="6" rx="1" />
    <path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3" />
    <path d="M12 12V8" />
    </>
  ),
  // upload.svg — Lucide (ISC), copied without a change.
  'import': (
    <>
    <path d="M12 3v12" />
    <path d="m17 8-5-5-5 5" />
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    </>
  ),
  // info.svg — Lucide (ISC), copied without a change.
  'info': (
    <>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-4" />
    <path d="M12 8h.01" />
    </>
  ),
  // link.svg — Lucide (ISC), copied without a change.
  'link': (
    <>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </>
  ),
  // corner-down-right.svg — Lucide (ISC), copied without a change.
  'links': (
    <>
    <path d="m15 10 5 5-5 5" />
    <path d="M4 4v7a4 4 0 0 0 4 4h12" />
    </>
  ),
  // move.svg — Lucide (ISC), copied without a change.
  'move': (
    <>
    <path d="M12 2v20" />
    <path d="m15 19-3 3-3-3" />
    <path d="m19 9 3 3-3 3" />
    <path d="M2 12h20" />
    <path d="m5 9-3 3 3 3" />
    <path d="m9 5 3-3 3 3" />
    </>
  ),
  // folder-plus.svg — Lucide (ISC), copied without a change.
  'new-folder': (
    <>
    <path d="M12 10v6" />
    <path d="M9 13h6" />
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </>
  ),
  // file-plus.svg — Lucide (ISC), copied without a change.
  'new-note': (
    <>
    <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
    <path d="M14 2v5a1 1 0 0 0 1 1h5" />
    <path d="M9 15h6" />
    <path d="M12 18v-6" />
    </>
  ),
  // chevron-right.svg — Lucide (ISC), copied without a change.
  'next': (
    <>
    <path d="m9 18 6-6-6-6" />
    </>
  ),
  // file-text.svg — Lucide (ISC), copied without a change.
  'note': (
    <>
    <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
    <path d="M14 2v5a1 1 0 0 0 1 1h5" />
    <path d="M10 9H8" />
    <path d="M16 13H8" />
    <path d="M16 17H8" />
    </>
  ),
  // panel-left.svg — Lucide (ISC), copied without a change.
  'notes-panel': (
    <>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M9 3v18" />
    </>
  ),
  // folder-open.svg — Lucide (ISC), copied without a change.
  'open-vault': (
    <>
    <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
    </>
  ),
  // orbit.svg — Lucide (ISC), copied without a change.
  'orbit': (
    <>
    <path d="M20.341 6.484A10 10 0 0 1 10.266 21.85" />
    <path d="M3.659 17.516A10 10 0 0 1 13.74 2.152" />
    <circle cx="12" cy="12" r="3" />
    <circle cx="19" cy="5" r="2" />
    <circle cx="5" cy="19" r="2" />
    </>
  ),
  // chevron-left.svg — Lucide (ISC), copied without a change.
  'previous': (
    <>
    <path d="m15 18-6-6 6-6" />
    </>
  ),
  // book-open.svg — Lucide (ISC), copied without a change.
  'read': (
    <>
    <path d="M12 5v16" />
    <path d="M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z" />
    </>
  ),
  // pencil.svg — Lucide (ISC), copied without a change.
  'rename': (
    <>
    <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
    <path d="m15 5 4 4" />
    </>
  ),
  // crosshair.svg — Lucide (ISC), copied without a change.
  'reset': (
    <>
    <circle cx="12" cy="12" r="10" />
    <line x1="22" x2="18" y1="12" y2="12" />
    <line x1="6" x2="2" y1="12" y2="12" />
    <line x1="12" x2="12" y1="6" y2="2" />
    <line x1="12" x2="12" y1="22" y2="18" />
    </>
  ),
  // archive-restore.svg — Lucide (ISC), copied without a change.
  'restore': (
    <>
    <rect width="20" height="5" x="2" y="3" rx="1" />
    <path d="M4 8v11a2 2 0 0 0 2 2h2" />
    <path d="M20 8v11a2 2 0 0 1-2 2h-2" />
    <path d="m9 15 3-3 3 3" />
    <path d="M12 12v9" />
    </>
  ),
  // search.svg — Lucide (ISC), copied without a change.
  'search': (
    <>
    <path d="m21 21-4.34-4.34" />
    <circle cx="11" cy="11" r="8" />
    </>
  ),
  // settings.svg — Lucide (ISC), copied without a change.
  'settings': (
    <>
    <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" />
    <circle cx="12" cy="12" r="3" />
    </>
  ),
  // keyboard.svg — Lucide (ISC), copied without a change.
  'shortcuts': (
    <>
    <path d="M10 8h.01" />
    <path d="M12 12h.01" />
    <path d="M14 8h.01" />
    <path d="M16 12h.01" />
    <path d="M18 8h.01" />
    <path d="M6 8h.01" />
    <path d="M7 16h10" />
    <path d="M8 12h.01" />
    <rect width="20" height="16" x="2" y="4" rx="2" />
    </>
  ),
  // box.svg — Lucide (ISC), copied without a change.
  'solid': (
    <>
    <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
    <path d="m3.3 7 8.7 5 8.7-5" />
    <path d="M12 22V12" />
    </>
  ),
  // columns-2.svg — Lucide (ISC), copied without a change.
  'split': (
    <>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M12 3v18" />
    </>
  ),
  // panel-top.svg — Lucide (ISC), copied without a change.
  'tabs': (
    <>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M3 9h18" />
    </>
  ),
  // calendar-days.svg — Lucide (ISC), copied without a change.
  'today': (
    <>
    <path d="M8 2v3" />
    <path d="M16 2v3" />
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18" />
    <path d="M8 13h.01" />
    <path d="M12 13h.01" />
    <path d="M16 13h.01" />
    <path d="M8 17h.01" />
    <path d="M12 17h.01" />
    <path d="M16 17h.01" />
    </>
  ),
  // trash-2.svg — Lucide (ISC), copied without a change.
  'trash': (
    <>
    <path d="M10 11v6" />
    <path d="M14 11v6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M3 6h18" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </>
  ),
  // rotate-ccw.svg — Lucide (ISC), copied without a change.
  'undo': (
    <>
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
    </>
  ),
  // database.svg — Lucide (ISC), copied without a change.
  'vaults': (
    <>
    <ellipse cx="12" cy="5" rx="9" ry="3" />
    <path d="M3 5V19A9 3 0 0 0 21 19V5" />
    <path d="M3 12A9 3 0 0 0 21 12" />
    </>
  ),
  // square-pen.svg — Lucide (ISC), copied without a change.
  'write': (
    <>
    <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z" />
    </>
  ),
  // plus.svg — Lucide (ISC), copied without a change.
  'zoom-in': (
    <>
    <path d="M5 12h14" />
    <path d="M12 5v14" />
    </>
  ),
  // minus.svg — Lucide (ISC), copied without a change.
  'zoom-out': (
    <>
    <path d="M5 12h14" />
    </>
  ),
};

export interface IconProps {
  /** The icon to draw. */
  name: IconName;
  /** Class names of the place the icon stands in. */
  className?: string;
  /** The size of the picture in pixels. */
  size?: number;
}

/** One icon of the set, drawn in the colour of the text it stands in. */
export default function Icon({ name, className, size = 16 }: IconProps) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name]}
    </svg>
  );
}
