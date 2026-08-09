import './styles/app.css'
import { registerSW } from 'virtual:pwa-register'
import { startRouter } from './router.js'
import { bindServiceWorker, markWaiting } from './core/version.js'

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
