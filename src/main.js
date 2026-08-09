import './styles/app.css'
import { registerSW } from 'virtual:pwa-register'
import { startRouter } from './router.js'
import { bindServiceWorker, markWaiting } from './core/version.js'
import { startAutoSync } from './core/sync.js'
import { applyTextWeight } from './core/settings.js'

// 라우터보다 먼저. 첫 그림부터 정한 굵기로 나와야 깜빡이지 않는다.
applyTextWeight()

// 새 버전을 강제로 들이밀지 않는다. 낱말을 찾는 도중에 화면이 새로고침되면
// 그게 더 성가시다. 대기 중이라는 사실만 기록해 두고, 설정 화면에서 사용자가
// 원할 때 적용한다.
const updateSW = registerSW({
  onRegisteredSW(_url, reg) {
    bindServiceWorker({ reg })
  },
  onNeedRefresh() {
    markWaiting()
  },
})

bindServiceWorker({ apply: updateSW })

startRouter()

// 기기 연동이 설정돼 있으면 켤 때 한 번, 덮을 때 한 번 합친다.
startAutoSync({
  onDone: (r, why) => {
    // 켤 때 합친 결과로 화면이 바뀌었으면 다시 그린다. 덮는 중에는 의미 없다.
    if (why === 'start' && (r.added || r.merged)) {
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    }
  },
})
