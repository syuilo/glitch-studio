import { spawnSync } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const packageDirectory = fileURLToPath(new URL('../', import.meta.url));
const revision = '4fa21912338357f89e4fd51cf2368325b59e9bd9'; // libwebp v1.6.0
const source = process.env.LIBWEBP_SOURCE ?? path.join(packageDirectory, '.build.local/libwebp');
function run(command, args, cwd = packageDirectory) {
	const result = spawnSync(command, args, { cwd, stdio: 'inherit', windowsHide: true });
	if (result.error != null) throw result.error;
	if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}
if (process.env.LIBWEBP_SOURCE == null) {
	await mkdir(source, { recursive: true });
	run('git', ['init', source]);
	run('git', ['-C', source, 'fetch', '--depth', '1', 'https://github.com/webmproject/libwebp.git', revision]);
	run('git', ['-C', source, 'checkout', '--detach', revision]);
}
const actualRevision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8', windowsHide: true });
if (actualRevision.stdout.trim() !== revision) throw new Error(`libwebp must be pinned to ${revision}`);
const sources = [];
for (const directory of ['dec', 'dsp', 'enc', 'utils']) {
	for (const name of (await readdir(path.join(source, 'src', directory))).sort()) {
		if (name.endsWith('.c')) sources.push(path.join(source, 'src', directory, name));
	}
}
for (const name of (await readdir(path.join(source, 'sharpyuv'))).sort()) {
	if (name.endsWith('.c')) sources.push(path.join(source, 'sharpyuv', name));
}
const functions = ['webp_encoder_create', 'webp_encoder_rows_per_block', 'webp_encoder_block', 'webp_encoder_write', 'webp_encoder_encode', 'webp_encoder_destroy'];
await mkdir(path.join(packageDirectory, 'src/codec'), { recursive: true });
const args = ['-O3', '-std=c11', '-msimd128', '-DNDEBUG', `-I${source}`, ...sources,
	path.join(packageDirectory, 'native/webp.c'),
	'-sFILESYSTEM=0', '-sALLOW_MEMORY_GROWTH=1', '-sMAXIMUM_MEMORY=4294967296', '-sABORTING_MALLOC=0',
	// JSPIは非同期writerの待機だけに使用する。Memory64や全結果のWebPMemoryWriterは使わない。
	'-sJSPI=1', '-sJSPI_EXPORTS=["webp_encoder_encode"]',
	'-sMODULARIZE=1', '-sEXPORT_ES6=1', '-sENVIRONMENT=web,worker',
	'-sINCOMING_MODULE_JS_API=["wasmBinary","locateFile"]',
	`-sEXPORTED_FUNCTIONS=${JSON.stringify(functions.map(name => `_${name}`))}`,
	'-sEXPORTED_RUNTIME_METHODS=["HEAPU8"]', '-o', path.join(packageDirectory, 'src/codec/webp.mjs')];
const compiler = process.env.EMCC ?? (process.platform === 'win32' ? 'emcc.bat' : 'emcc');
if (compiler.endsWith('.py')) run(process.env.PYTHON ?? 'python', [compiler, ...args]);
else if (process.platform === 'win32' && compiler.endsWith('.bat')) throw new Error('Set EMCC to the absolute path of emcc.py on Windows.');
else run(compiler, args);
const license = Buffer.concat([await readFile(path.join(source, 'COPYING')), Buffer.from('\n\n'), await readFile(path.join(source, 'PATENTS'))]);
await writeFile(path.join(packageDirectory, 'src/codec/LICENSE.libwebp.txt'), license);
await writeFile(path.join(packageDirectory, '../../glitch-studio/ui/public/licenses/libwebp.txt'), license);
console.log(`Built libwebp ${revision} (WASM32, 4 GiB, JSPI)`);
