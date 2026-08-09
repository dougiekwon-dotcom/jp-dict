import './styles/app.css'
import { registerSW } from 'virtual:pwa-register'
import { startRouter } from './router.js'

const update = registerSW({
  onNeedRefresh() {
    if (confirm('새 버전이 있습니다. 새로고침할까요?')) update(true)
  },
})

startRouter()
