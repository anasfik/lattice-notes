/**
 * The few Node built-ins the visual identity check needs.
 *
 * The project has no `@types/node`, so the two calls the check uses are
 * declared here instead of adding a dependency for two signatures.
 */
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function readdirSync(path: string): string[];
}
