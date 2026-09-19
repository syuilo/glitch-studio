import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

export async function createTestServer(t) {
	const server = await createServer({
		root: fileURLToPath(new URL('../..', import.meta.url)), configFile: false,
		resolve: { alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) } },
		server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom',
		optimizeDeps: { noDiscovery: true, include: [] },
		plugins: [{
			name: 'test-preferences',
			transform(code, id) {
				if (id.replaceAll('\\', '/').endsWith('/src/preferences.ts')) {
					return 'export const preferences = { s: { forceTypeSafety: false } };';
				}
			},
		}],
	});
	t.after(() => server.close());
	return server;
}
