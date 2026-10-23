import { useId } from 'react';

export interface BrandMarkProps {
  /** Class names of the place the mark stands in. */
  className?: string;
  /** The size of the mark in pixels. */
  size?: number;
}

/**
 * The mark of Lattice Notes: three threads in each direction, woven over and
 * under each other.
 *
 * The threads are drawn in two families and each family is cut where the
 * other one passes over it, so the mark reads as cloth rather than as a
 * grid. The cut is a mask, and the ids of the masks are unique, so the mark
 * can stand on the screen more than once.
 *
 * The mark is a picture, so it is hidden from the reader: the name of the
 * product beside it carries the brand.
 */
export default function BrandMark({ className, size = 28 }: BrandMarkProps) {
  // The ids of the masks have to be unique, or the second mark on the page
  // would borrow the cuts of the first one. The id of React holds marks and
  // colons, which a reference in a mask cannot carry.
  const id = `brand-mark-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  return (
    <svg
      className={className ? `brand-mark ${className}` : 'brand-mark'}
      width={size}
      height={size}
      viewBox="0 0 512 512"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        {/* The vertical threads are cut where a horizontal one passes over. */}
        <mask id={`${id}-vertical`}>
          <rect width="512" height="512" fill="#fff" />
          <rect x="241" y="113" width="30" height="30" fill="#000" />
          <rect x="113" y="241" width="30" height="30" fill="#000" />
          <rect x="369" y="241" width="30" height="30" fill="#000" />
          <rect x="241" y="369" width="30" height="30" fill="#000" />
        </mask>
        {/* The horizontal threads are cut where a vertical one passes over. */}
        <mask id={`${id}-horizontal`}>
          <rect width="512" height="512" fill="#fff" />
          <rect x="113" y="113" width="30" height="30" fill="#000" />
          <rect x="369" y="113" width="30" height="30" fill="#000" />
          <rect x="241" y="241" width="30" height="30" fill="#000" />
          <rect x="113" y="369" width="30" height="30" fill="#000" />
          <rect x="369" y="369" width="30" height="30" fill="#000" />
        </mask>
      </defs>
      <rect className="brand-mark__plate" width="512" height="512" rx="96" />
      <g
        className="brand-mark__thread brand-mark__thread--a"
        mask={`url(#${id}-vertical)`}
        strokeWidth="24"
        strokeLinecap="round"
        fill="none"
      >
        <line x1="128" y1="64" x2="128" y2="448" />
        <line x1="256" y1="64" x2="256" y2="448" />
        <line x1="384" y1="64" x2="384" y2="448" />
      </g>
      <g
        className="brand-mark__thread brand-mark__thread--b"
        mask={`url(#${id}-horizontal)`}
        strokeWidth="24"
        strokeLinecap="round"
        fill="none"
      >
        <line x1="64" y1="128" x2="448" y2="128" />
        <line x1="64" y1="256" x2="448" y2="256" />
        <line x1="64" y1="384" x2="448" y2="384" />
      </g>
    </svg>
  );
}
