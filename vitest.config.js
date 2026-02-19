import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.js'],
    exclude: [
      'node_modules', 
      'dist',
      'tests/security.test.js',  // Uses custom test format
      'tests/crypto.test.js',    // Uses custom test format
      'tests/seed-restore.test.js' // Uses custom test format
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['core/**/*.js', 'network/**/*.js'],
      exclude: ['tests/**']
    },
    testTimeout: 10000,
    hookTimeout: 10000
  }
});
