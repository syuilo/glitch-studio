import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { test } from 'node:test';

// 【実ElectronのUtilityProcessで開発用・配布済み資材から最適化JSを生成する】
// Node単体では分からないASAR内のimport、外部実行ファイルの起動、IPCと中断を確認する。
// 配布検証ではGLITCH_PORTABLE_PACKAGED_RESOURCESに展開済みアプリのresourcesを指定する。
test('builds portable runtimes in a real Electron utility process', { skip: process.env.GLITCH_ELECTRON_TEST !== '1', timeout: 60000 }, async t => {
	const temporaryRoot = path.resolve(tmpdir());
	const directory = await mkdtemp(path.join(temporaryRoot, 'glitch-portable-electron-'));
	t.after(async () => {
		assert.equal(path.dirname(path.resolve(directory)), temporaryRoot);
		assert.ok(path.basename(directory).startsWith('glitch-portable-electron-'));
		await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	});
	const resources = process.env.GLITCH_PORTABLE_PACKAGED_RESOURCES;
	const applicationDirectory = resources == null ? fileURLToPath(new URL('../', import.meta.url)) : path.join(resources, 'app.asar');
	const workerPath = path.join(applicationDirectory, 'dist/portable-custom-node-graph-effect-worker.mjs');
	const catalog = resources == null ? path.join(applicationDirectory, 'dist/portable-custom-node-graph-effect-catalog') : path.join(resources, 'portable-custom-node-graph-effect-catalog');
	const binary = resources == null ? null : path.join(`${applicationDirectory}.unpacked`, 'node_modules/@esbuild', `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'esbuild.exe' : 'bin/esbuild');
	const helper = path.join(directory, 'main.cjs');
	await writeFile(helper, `
		const { app, utilityProcess } = require('electron');
		const assert = require('node:assert/strict');
		const { EventEmitter } = require('node:events');
		app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
		app.whenReady().then(async () => {
			const { registerPortableCustomNodeGraphEffectIpc } = await import(${JSON.stringify(pathToFileURL(path.join(applicationDirectory, 'portable-custom-node-graph-effect-ipc.mjs')).href)});
			const handlers = new Map();
			const event = { sender: Object.assign(new EventEmitter(), { id: 1 }) };
			registerPortableCustomNodeGraphEffectIpc({ handle: (name, handler) => handlers.set(name, handler) }, utilityProcess,
				${JSON.stringify(workerPath)}, ${JSON.stringify(catalog)}, () => {}, ${JSON.stringify(binary)});
			const build = (id, requirements) => handlers.get('desktop:build-portable-custom-node-graph-effect')(event, id, requirements);
			const requirements = { effectIds: ['fill'], requiresExpressions: false, requiresCustomShaderEffects: false };
			const canceled = build('canceled', requirements);
			handlers.get('desktop:cancel-portable-custom-node-graph-effect')(event, 'canceled');
			await assert.rejects(canceled, /canceled/);
			const runtime = await build('complete', requirements);
			assert.doesNotMatch(runtime.workerSource, /AiScript|VideoSampleSink/);
			assert.ok(runtime.workerSource.length > 1000);
			// 内蔵画像も配布カタログだけから取得でき、Viteの実行環境を要求しない。
			const symbols = await build('symbols', { ...requirements, effectIds: ['symbols'] });
			assert.match(symbols.workerSource, /data:image\\/png;base64,/);
			assert.doesNotMatch(symbols.workerSource, /BASE_URL/);
			await assert.rejects(build('invalid', { ...requirements, effectIds: ['../expression'] }), /Invalid/);
			console.log('PORTABLE_ELECTRON_OK', runtime.elementSource.length, runtime.workerSource.length);
			app.exit(0);
		}).catch(error => { console.error(error); app.exit(1); });
	`);
	const executable = createRequire(import.meta.url)('electron');
	const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
	const result = await new Promise((resolve, reject) => {
		const child = spawn(executable, [helper], { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
		let output = '';
		child.stdout.on('data', data => { output += data; });
		child.stderr.on('data', data => { output += data; });
		const timer = setTimeout(() => { child.kill(); reject(new Error('Electron export test timed out: ' + output)); }, 45000);
		child.once('error', error => { clearTimeout(timer); reject(error); });
		child.once('exit', code => { clearTimeout(timer); resolve({ code, output }); });
	});
	assert.equal(result.code, 0, result.output);
	assert.match(result.output, /PORTABLE_ELECTRON_OK/);
});
