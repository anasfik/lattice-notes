/// <reference types="vitest/config" />
import { defineConfig, type Plugin, type ResolvedConfig } from 'vite';
import react from '@vitejs/plugin-react';

const PRECACHE_MARKER = 'const PRECACHE = /* __PRECACHE_LIST__ */ [];';
const VERSION_MARKER = "const VERSION = '__CACHE_VERSION__';";
const VERSION_TOKEN = '__CACHE_VERSION__';
const REQUIRED_FILES = ['index.html', 'manifest.webmanifest', 'icon.svg'];

/**
 * Writes the offline shell after the build.
 *
 * `public/sw.js` is a hand written template with two markers. This plugin
 * fills them with the real precache list of the finished `dist/` and with a
 * hash of the template and of every precached file, so a rebuild replaces
 * the shell and an identical rebuild does not.
 */
function offlineShell(): Plugin {
  let config!: ResolvedConfig;

  return {
    name: 'lattice-notes-offline-shell',
    apply: 'build',
    configResolved(resolved) {
      config = resolved;
    },
    async closeBundle(error) {
      if (error) return;

      const root = config.root.replace(/\/+$/, '');
      const outDir = config.build.outDir.startsWith('/')
        ? config.build.outDir
        : `${root}/${config.build.outDir}`;
      if (!config.publicDir) throw new Error('offline shell: publicDir is disabled');
      const fs = this.fs;

      const walk = async (dir: string, prefix = ''): Promise<string[]> => {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        const files: string[] = [];
        for (const entry of entries) {
          const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) files.push(...(await walk(`${dir}/${entry.name}`, relative)));
          else files.push(relative);
        }
        return files;
      };

      const template = await fs.readFile(`${config.publicDir.replace(/\/+$/, '')}/sw.js`, {
        encoding: 'utf8',
      });
      if (!template.includes(PRECACHE_MARKER) || !template.includes(VERSION_MARKER)) {
        throw new Error('offline shell: public/sw.js is missing its injection markers');
      }
      const files = (await walk(outDir))
        .filter((file) => file !== 'sw.js' && !file.endsWith('.map') && !file.endsWith('.DS_Store'))
        .sort();

      for (const required of REQUIRED_FILES) {
        if (!files.includes(required)) throw new Error(`offline shell: dist/${required} is missing`);
      }

      const precache = ['./', ...files.map((file) => `./${file}`)];

      const encoder = new TextEncoder();
      const chunks: Uint8Array[] = [encoder.encode(template), new Uint8Array([0])];
      for (const file of files) {
        chunks.push(
          encoder.encode(file),
          new Uint8Array([0]),
          await fs.readFile(`${outDir}/${file}`, { encoding: null }),
          new Uint8Array([0]),
        );
      }

      const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }

      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      const version = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0'))
        .join('')
        .slice(0, 12);

      const source = template
        .replace(PRECACHE_MARKER, `const PRECACHE = /* __PRECACHE_LIST__ */ ${JSON.stringify(precache)};`)
        .replaceAll(VERSION_TOKEN, version);

      if (!source.includes(`'lattice-notes-shell-${version}'`)) {
        throw new Error('offline shell: public/sw.js does not name the shell cache');
      }

      await fs.writeFile(`${outDir}/sw.js`, source, { encoding: 'utf8' });
    },
  };
}

export default defineConfig({
  plugins: [react(), offlineShell()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
