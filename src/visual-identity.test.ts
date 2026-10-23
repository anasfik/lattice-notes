import { readFileSync, readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

declare const process: { cwd(): string };

/**
 * The visual identity contract.
 *
 * The look of the product lives in the stylesheet and in the assets of the
 * shell, so a check that only looked at the rendered DOM would miss a token
 * that was renamed, a palette that came back or a mark that was replaced. The
 * check reads the sources of the product and holds them to the design.
 */

const root = process.cwd();

const read = (path: string): string => readFileSync(`${root}/${path}`, 'utf8');

const css = read('src/styles.css');
const html = read('index.html');
const icon = read('public/icon.svg');
const manifest = JSON.parse(read('public/manifest.webmanifest')) as {
  background_color: string;
  theme_color: string;
  name: string;
};

/** The sources of the parts that carry the look of the product. */
const surfaces = [
  'src/App.tsx',
  ...readdirSync(`${root}/src/components`)
    .filter((name) => name.endsWith('.tsx') && !name.endsWith('.test.tsx'))
    .map((name) => `src/components/${name}`),
];

/** The palette of the design, as the stylesheet has to name it. */
const PRIMITIVES = [
  '--paper: #f6f3ec',
  '--white: #fffdf8',
  '--ink: #242924',
  '--muted: #62665e',
  '--copper: #99512e',
  '--dark: #202923',
];

/** The semantic names the components consume. */
const SEMANTIC = [
  '--color-bg',
  '--color-surface',
  '--color-surface-raised',
  '--color-surface-sunken',
  '--color-border',
  '--color-border-strong',
  '--color-ink',
  '--color-ink-muted',
  '--color-ink-faint',
  '--color-accent',
  '--color-accent-ink',
  '--color-focus',
  '--color-danger',
];

/** The palette of the identity this product had before the rebuild. */
const LEGACY = [
  '#a78bfa',
  '#101215',
  '#171a1f',
  '#1e222a',
  '#0b0d10',
  '#262b33',
  '#6a7382',
  '#f4f1ea',
  '#a8adb7',
  '#848c9b',
  '#f0a58f',
  '#14101f',
];

describe('visual identity', () => {
  it('names the paper, ink and copper primitives', () => {
    for (const token of PRIMITIVES) {
      expect(css, `the stylesheet is missing ${token}`).toContain(token);
    }
  });

  it('maps every semantic name of the contract onto a surface', () => {
    for (const token of SEMANTIC) {
      expect(css, `the stylesheet is missing ${token}`).toContain(`${token}:`);
    }
  });

  it('keeps the dark index on its own high contrast tokens', () => {
    expect(css).toContain('--color-ink-muted: var(--dark-muted)');
    expect(css).toContain('--color-accent: var(--copper-light)');
    expect(css).toContain('--color-ink: var(--paper)');
  });

  it('has no trace of the palette before the rebuild', () => {
    for (const hex of LEGACY) {
      expect(css, `${hex} came back`).not.toContain(hex);
    }
  });

  it('sets a serif for the document, a sans for the controls and a mono for Markdown', () => {
    expect(css).toContain('--font-serif:');
    expect(css).toContain('Georgia');
    expect(css).toContain('--font-sans:');
    expect(css).toContain('system-ui');
    expect(css).toContain('--font-mono:');
    expect(css).toContain('ui-monospace');
  });

  it('falls back to an Arabic face and lays the writing out logically', () => {
    expect(css).toMatch(/Noto (Naskh|Sans) Arabic/);
    expect(css).toMatch(/padding-inline|margin-inline/);
    expect(css).toMatch(/border-inline-start/);
  });

  it('keeps one control radius of four pixels', () => {
    expect(css).toContain('--radius-sm: 4px');
  });

  it('gives every class of the surfaces a rule', () => {
    const used = new Set<string>();
    for (const path of surfaces) {
      const source = read(path);
      for (const match of source.matchAll(/\b([a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:__[a-z0-9]+(?:-[a-z0-9]+)*)+)\b/g)) {
        used.add(match[1]!);
      }
    }
    const missing = [...used].filter((name) => !css.includes(`.${name}`)).sort();
    expect(missing, 'these classes have no rule and fall back to the platform').toEqual([]);
  });

  it('draws the contextual fullscreen graph control itself', () => {
    const rule = css.match(/\.context__graph-open\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(/background/);
    expect(rule).toMatch(/border/);
  });

  it('carries the interlaced mark on the chrome and on the welcome', () => {
    expect(read('src/components/BrandMark.tsx')).toContain('<svg');
    expect(read('src/components/Workspace.tsx')).toContain('<BrandMark');
    expect(read('src/components/Onboarding.tsx')).toContain('<BrandMark');
  });

  it('draws the interlaced mark in the icon of the app', () => {
    expect(icon).toContain('<mask');
    expect(icon).toContain('#202923');
    expect(icon).toContain('#d18a5e');
    expect(icon).toContain('#f6f3ec');
  });

  it('matches the metadata of the shell to the identity', () => {
    expect(html).toContain('rel="apple-touch-icon" href="%BASE_URL%apple-touch-icon.png"');
    expect(manifest.theme_color).toBe('#202923');
    expect(manifest.background_color).toBe('#f6f3ec');
    expect(manifest.name).toBe('Lattice Notes');
    expect(html).toContain('name="theme-color" content="#202923"');
    expect(html).toContain('property="og:title"');
    expect(html).toContain('property="og:image"');
    expect(html).toContain('name="color-scheme" content="light"');
  });
});
