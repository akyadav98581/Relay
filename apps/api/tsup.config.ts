import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  splitting: false,
  // The shared package ships as TypeScript source, so it has to be bundled in.
  noExternal: ['@relay/shared'],
  // Only used in local development, and it carries native binaries.
  external: ['embedded-postgres'],
  // Bundled CommonJS code still calls require(); give the ESM output one.
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
})
