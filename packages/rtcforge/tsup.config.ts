import { defineConfig } from 'tsup'

// rtcforge is the single published package. Its four entry points re-export the
// first-party sub-packages (rtcforge-sdk/-signaling/-media/-core), which are
// private and never published. tsconfig `paths` (see ./tsconfig.json) map those
// bare specifiers to the sub-packages' TypeScript *source*, so both the JS
// (esbuild) and the type declarations (rollup-plugin-dts) treat them as local
// modules and inline them fully into the bundle — making the published package
// self-contained. Third-party runtime deps (ws, zod) and the optional mediasoup
// peer stay external and resolve from the consumer's node_modules.
export default defineConfig({
    entry: {
        client: 'src/client.ts',
        server: 'src/server.ts',
        media: 'src/media.ts',
        filetransfer: 'src/filetransfer.ts',
    },
    format: ['cjs', 'esm'],
    dts: true,
    clean: true,
    target: 'es2020',
    tsconfig: 'tsconfig.json',
    outDir: 'dist',
    external: ['ws', 'zod', 'mediasoup'],
    outExtension({ format }) {
        return { js: format === 'cjs' ? '.cjs' : '.mjs' }
    },
})
