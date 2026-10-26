import { defineConfig } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// The in-page Connect core (`?trezor=bridge|webusb`) expects Node globals and builtins.
// In production Suite hosts the core, so the console would not need these.
export default defineConfig({
  plugins: [nodePolyfills()],
  server: { port: 5173, strictPort: true },
})
