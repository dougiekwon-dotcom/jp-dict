import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages 프로젝트 사이트는 /<repo>/ 아래로 서빙된다. 워크플로가 레포명에서
// BASE를 주입하므로 레포 이름이 바뀌어도 손댈 곳이 없다. dev/build/preview에서
// 동일하게 유지해야 빌드된 HTML의 자산 경로와 실제 서빙 경로가 어긋나지 않는다.
const REPO_BASE = process.env.BASE || '/jp-dict/'

export default defineConfig(() => ({
  base: REPO_BASE,
  build: {
    target: 'es2020',
    outDir: 'dist',
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/**/*'],
      manifest: {
        name: '요미 — 일본어 사전',
        short_name: '요미',
        description: '한글 발음·손글씨로 찾는 일본어 사전과 단어장',
        lang: 'ko',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        background_color: '#f5f2ea',
        theme_color: '#1f6f6b',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 사전 JSON이 2MB라 기본 상한(2MiB)에 걸린다. 오프라인 검색이 이 앱의
        // 핵심이므로 프리캐시 대상에서 빼지 않고 상한을 올린다.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,png,svg,json}'],
      },
      devOptions: { enabled: false },
    }),
  ],
}))
