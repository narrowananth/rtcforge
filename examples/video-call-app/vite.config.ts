import path from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
    server: { port: 5175 },
    resolve: {
        alias: {
            '@rtcforge/sdk': path.resolve('../../packages/sdk/src/index.ts'),
            '@rtcforge/signaling': path.resolve('../../packages/signaling/src/index.ts'),
            '@rtcforge/media': path.resolve('../../packages/media/src/index.ts'),
            '@rtcforge/recording': path.resolve('../../packages/recording/src/index.ts'),
        },
    },
})
