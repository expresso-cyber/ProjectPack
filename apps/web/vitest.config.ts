import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // jsdom gives us DOMParser (HTML parsing) and IndexedDB (via the setup shim)
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
  },
});
