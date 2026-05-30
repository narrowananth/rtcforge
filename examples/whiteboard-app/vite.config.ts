import path from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
    server: { port: 5177 },
    resolve: {
        alias: {
            '@rtcforge/sdk': path.resolve('../../packages/sdk/src/index.ts'),
        },
    },
})
