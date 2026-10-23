import { describe, expect, it } from 'vitest';
import { isValidElement, type ReactNode } from 'react';

import Icon, { ICON_NAMES } from './Icon';

/** Every element of a picture, however deep it sits. */
function elementsOf(node: ReactNode): { type: string; props: Record<string, unknown> }[] {
  if (!isValidElement(node)) return [];
  const props = node.props as { children?: ReactNode };
  const children = props.children;
  if (Array.isArray(children)) return children.flatMap(elementsOf);
  return elementsOf(children as ReactNode);
}

describe('the icon set', () => {
  it('draws an icon for every name of the set', () => {
    for (const name of ICON_NAMES) {
      const element = Icon({ name });
      expect(element.type, `${name} has no picture`).toBe('svg');
    }
  });

  it('hides the picture from the reader, so the name beside it carries it', () => {
    const element = Icon({ name: 'search' });

    expect(element.props['aria-hidden']).toBe('true');
    expect(element.props.focusable).toBe('false');
  });

  it('takes the colour of the text it stands in', () => {
    expect(Icon({ name: 'search' }).props.stroke).toBe('currentColor');
  });

  it('asks for nothing from the network', () => {
    const markup = JSON.stringify(Icon({ name: 'folder' }).props.children);

    expect(markup).not.toContain('http');
    expect(markup).not.toContain('url(');
  });

  it('names the icons of the set, so a typo cannot reach the screen', () => {
    expect(ICON_NAMES).toContain('search');
    expect(ICON_NAMES).toContain('folder');
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
  });

  it('draws every line of a picture with its place', () => {
    for (const name of ICON_NAMES) {
      for (const element of elementsOf(Icon({ name }).props.children as ReactNode)) {
        if (element.type !== 'line') continue;
        for (const coordinate of ['x1', 'x2', 'y1', 'y2']) {
          expect(
            element.props[coordinate],
            `the ${name} icon has a line without ${coordinate}`,
          ).toBeDefined();
        }
      }
    }
  });
});
