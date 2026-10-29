import type { CardForgeApi } from '../shared/ipc'

declare global {
  interface Window {
    cardforge: CardForgeApi
  }
}

export {}
