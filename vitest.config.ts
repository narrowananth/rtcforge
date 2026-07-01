import { defineConfig } from 'vitest/config'

const pkg = (name: string) => new URL(`./packages/${name}/src/index.ts`, import.meta.url).pathname

export default defineConfig({
    test: {
        include: ['packages/*/tests/**/*.test.ts'],
        environment: 'node',
    },
    resolve: {
        alias: {
            'rtcforge-core': pkg('core'),
            'rtcforge-signaling': pkg('signaling'),
            'rtcforge-sdk': pkg('sdk'),
            'rtcforge-media': pkg('media'),
            'rtcforge-sfu': pkg('sfu'),
            'rtcforge-adapter-udp': pkg('adapter-udp'),
        },
    },
})
