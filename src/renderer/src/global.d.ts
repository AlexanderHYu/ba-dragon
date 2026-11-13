/// <reference types="vite/client" />
import type { BridgeApi } from '../../preload'

declare global {
  interface Window {
    BA: BridgeApi
  }
}
export {}
