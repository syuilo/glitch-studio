import { randomUUID } from 'node:crypto';
import { open, rename, unlink } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { nativeEffectDefinitions } from '../src/definitions.ts';
import { findChromeExecutable } from './chrome-executable.mjs';
import { runEffectInChrome } from './run-effect-in-chrome.mjs';

const usage = 'Usage: pnpm generate:effect-thumbnails [--effect <native-effect-id>]';

async function writeThumbnail(nativeEffectId, webp) {
	const directory = new URL(`../src/fx/${nativeEffectId}/`, import.meta.url);
	const destination = new URL('thumbnail.webp', directory);
	const temporary = new URL(`.thumbnail-${randomUUID()}.webp.tmp`, directory);
	// 保存途中に停止しても元の画像を壊さないよう、同じディレクトリで書き終えてから置き換える。
	const file = await open(temporary, 'wx');
	try {
		try {
			await file.writeFile(webp);
		} finally {
			await file.close();
		}
		await rename(temporary, destination);
	} finally {
		await unlink(temporary).catch(error => {
			if (error.code !== 'ENOENT') throw error;
		});
	}
}

async function main() {
	const { values } = parseArgs({ options: { effect: { type: 'string' }, help: { type: 'boolean', short: 'h' } } });
	if (values.help === true) {
		console.log(usage);
		return;
	}
	const requestedId = values.effect;
	if (requestedId != null && !Object.hasOwn(nativeEffectDefinitions, requestedId)) throw new Error(`Unknown Native Effect: ${requestedId}`);
	const requests = Object.entries(nativeEffectDefinitions).flatMap(([id, definition]) => {
		if (requestedId != null && id !== requestedId) return [];
		const thumbnail = definition.thumbnail;
		return thumbnail?.mode === 'defaultParameters' || thumbnail?.mode === 'customParameters' ? [{ id, thumbnail }] : [];
	});
	if (requests.length === 0) {
		console.log(requestedId == null ? 'No Native Effects are configured for automatic thumbnail generation.' : `${requestedId}: thumbnail generation skipped.`);
		return;
	}
	const chromePath = findChromeExecutable();
	if (chromePath == null) throw new Error('Google Chrome was not found. Install Chrome or set CHROME_PATH to its executable.');
	const results = await runEffectInChrome(new URL('./render-thumbnails.ts', import.meta.url), 'renderThumbnails', {
		chromePath, timeout: 30_000 + 20_000 * requests.length, args: [requests],
	});
	for (const { id, error, base64 } of results) {
		try {
			if (error != null) throw new Error(error);
			await writeThumbnail(id, Buffer.from(base64, 'base64'));
			console.log(`${id}: wrote thumbnail.webp`);
		} catch (error) {
			console.error(`${id}: ${error.message}`);
			process.exitCode = 1;
		}
	}
}

try {
	await main();
} catch (error) {
	console.error(error.message);
	if (error.code?.startsWith('ERR_PARSE_ARGS_') === true) console.error(usage);
	process.exitCode = 1;
}
