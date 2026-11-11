import { spawnSync } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const packageDirectory = fileURLToPath(new URL('../', import.meta.url));
const revision = 'd8a16915fce4efb562758e90b39c5ca6ddf42abf';
const source = process.env.TINYEXR_SOURCE ?? path.join(packageDirectory, '.build.local/tinyexr');
function run(command, args, cwd = packageDirectory) {
	const result = spawnSync(command, args, { cwd, stdio: 'inherit', windowsHide: true });
	if (result.error != null) throw result.error;
	if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}
if (process.env.TINYEXR_SOURCE == null) {
	await mkdir(source, { recursive: true });
	run('git', ['init', source]);
	run('git', ['-C', source, 'fetch', '--depth', '1', 'https://github.com/syoyo/tinyexr.git', revision]);
	run('git', ['-C', source, 'checkout', '--detach', revision]);
}
const actualRevision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8', windowsHide: true });
if (actualRevision.stdout.trim() !== revision) throw new Error(`TinyEXR must be pinned to ${revision}`);
const excluded = new Set(['exr_stdio.c', 'exr_freestanding.c', 'exr_spectral.c', 'exr_gpu_cuda.c', 'exr_vk_vulkan.c', 'exr_zstd.c']);
const sources = (await readdir(path.join(source, 'src'))).filter(name => name.endsWith('.c') && !excluded.has(name)).sort().map(name => path.join(source, 'src', name));
const functions = ['openexr_encoder_create', 'openexr_encoder_pixels', 'openexr_encoder_write', 'openexr_encoder_finish', 'openexr_encoder_data', 'openexr_encoder_chunk_size', 'openexr_encoder_size', 'openexr_encoder_destroy', 'exr_result_string'];
await mkdir(path.join(packageDirectory, 'src/codec'), { recursive: true });
const args = ['-O3', '-std=c11', '-DEXR_NO_ZSTD', `-I${source}/include`, `-I${source}/src`, ...sources,
	path.join(packageDirectory, 'native/openexr.c'),
	// 16K HALF RGBAは無圧縮で2GiBを超えるため、WASM32の4GiBまで成長を許可する。
	'-sFILESYSTEM=0', '-sALLOW_MEMORY_GROWTH=1', '-sMAXIMUM_MEMORY=4294967296', '-sABORTING_MALLOC=0',
	'-sMODULARIZE=1', '-sEXPORT_ES6=1', '-sENVIRONMENT=web,worker',
	'-sINCOMING_MODULE_JS_API=["wasmBinary","locateFile"]',
	`-sEXPORTED_FUNCTIONS=${JSON.stringify(functions.map(name => `_${name}`))}`,
	'-sEXPORTED_RUNTIME_METHODS=["HEAPU8","HEAPU16","UTF8ToString"]',
	'-o', path.join(packageDirectory, 'src/codec/tinyexr.mjs')];
// EMCCは実行ファイルまたはemcc.pyの絶対パス。Windowsでもshellの文字列展開を経由しない。
const compiler = process.env.EMCC ?? (process.platform === 'win32' ? 'emcc.bat' : 'emcc');
if (compiler.endsWith('.py')) run(process.env.PYTHON ?? 'python', [compiler, ...args]);
else if (process.platform === 'win32' && compiler.endsWith('.bat')) throw new Error('Set EMCC to the absolute path of emcc.py on Windows.');
else run(compiler, args);
await writeFile(path.join(packageDirectory, 'src/codec/LICENSE.tinyexr.txt'), await readFile(path.join(source, 'LICENSE')));
console.log(`Built TinyEXR ${revision}`);
