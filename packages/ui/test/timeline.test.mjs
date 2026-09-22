import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

async function loadTimeline() {
	const bundled = await build({
		absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
		entryPoints: ['./src/timeline.ts'],
		bundle: true,
		platform: 'node',
		format: 'cjs',
		write: false,
		plugins: [{
			name: 'timeline-test-app-stub',
			setup(build) {
				build.onResolve({ filter: /app\.ts$/ }, () => ({ path: 'app-stub', namespace: 'timeline-test' }));
				build.onLoad({ filter: /.*/, namespace: 'timeline-test' }, () => ({ contents: 'export const fpsLimit = { value: null };', loader: 'ts' }));
			},
		}],
	});
	const module = { exports: {} };
	new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
	return module.exports;
}

// 停止していた実時間を再開直後の再生時間に加算せず、停止時のシーク位置から進める。
test('resumes timeline playback from the stopped position', async t => {
	const frameCallbacks = new Map();
	let nextFrameId = 1;
	globalThis.window = {
		requestAnimationFrame(callback) {
			const id = nextFrameId++;
			frameCallbacks.set(id, callback);
			return id;
		},
		cancelAnimationFrame(id) {
			frameCallbacks.delete(id);
		},
	};
	t.after(() => { delete globalThis.window; });

	const { currentTimelineTime, playTimeline, stopTimeline } = await loadTimeline();
	const runNextFrame = timeStamp => {
		const [id, callback] = frameCallbacks.entries().next().value;
		frameCallbacks.delete(id);
		callback(timeStamp);
	};

	playTimeline();
	runNextFrame(1_000);
	assert.equal(currentTimelineTime.value, 0);
	runNextFrame(1_017);
	assert.equal(currentTimelineTime.value, 17);

	stopTimeline();
	playTimeline();
	runNextFrame(5_017);
	assert.equal(currentTimelineTime.value, 17);
	runNextFrame(5_034);
	assert.equal(currentTimelineTime.value, 34);
	stopTimeline();
});
