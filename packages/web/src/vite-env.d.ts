/// <reference types="vite/client" />

/**
 * Stylesheets imported for their side effect.
 *
 * Vite turns these into a `<link>`; TypeScript only needs to know the import is
 * legal. Declared here rather than reached for per file, so the next one does
 * not have to rediscover it.
 */
declare module '*.css' {
  const url: string
  export default url
}
