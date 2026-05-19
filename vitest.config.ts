import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        include: ['packages/*/tests/**/*.test.ts'],
        environment: 'node',
    },
    resolve: {
        alias: {
            '@rtcforge/signaling': new URL('./packages/signaling/src/index.ts', import.meta.url)
                .pathname,
            '@rtcforge/sdk': new URL('./packages/sdk/src/index.ts', import.meta.url).pathname,
            '@rtcforge/chat': new URL('./packages/chat/src/index.ts', import.meta.url).pathname,
            '@rtcforge/media': new URL('./packages/media/src/index.ts', import.meta.url).pathname,
        },
    },
})
