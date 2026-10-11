import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 相対パスでビルドし、任意の静的ホスティング/ローカルファイル配信で動かせるようにする（サーバー機能は持たない）
  base: './',
  build: {
    target: 'es2022',
    // Rapier の WASM を base64 同梱しているため本体が約5MBになる（TODO.md: WASM分離）
    chunkSizeWarningLimit: 5500,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
