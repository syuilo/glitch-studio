import { spawn } from 'node:child_process';
import path from 'node:path';
import electron from 'electron';
import { createServer } from 'vite';

process.env.BUILD_TARGET = 'electron';
const uiRoot = path.resolve(import.meta.dirname, '../ui');
const server = await createServer({
	root: uiRoot,
	configFile: path.join(uiRoot, 'vite.config.ts'),
	server: { host: '127.0.0.1', port: 0, allowedHosts: ['127.0.0.1'] },
});
let child;
let stopping = false;

async function stop(code) {
	if (stopping) return;
	stopping = true;
	child?.kill();
	await server.close();
	process.exitCode = code;
}

process.on('SIGINT', () => { void stop(130); });
process.on('SIGTERM', () => { void stop(143); });

try {
	await server.listen();
	const address = server.httpServer.address();
	const env = { ...process.env, GLITCH_DESKTOP_DEV_URL: 'http://127.0.0.1:' + address.port + '/' };
	delete env.ELECTRON_RUN_AS_NODE;
	child = spawn(electron, [import.meta.dirname], { env, stdio: 'inherit', windowsHide: true });
	child.on('error', error => {
		console.error(error);
		void stop(1);
	});
	child.on('exit', code => { void stop(code ?? 1); });
} catch (error) {
	console.error(error);
	await stop(1);
}
