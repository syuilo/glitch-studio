import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';
import { effectScope, nextTick, ref, shallowRef } from 'vue';

const bundled = await build({
	entryPoints: [fileURLToPath(new URL('../src/use-renderer-canvas.ts', import.meta.url))],
	bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { useRendererCanvas } = module.exports;

function element() {
	return {
		children: [], parentNode: null,
		appendChild(child) {
			child.parentNode?.removeChild(child);
			this.children.push(child);
			child.parentNode = this;
		},
		removeChild(child) {
			assert.equal(child.parentNode, this);
			this.children.splice(this.children.indexOf(child), 1);
			child.parentNode = null;
		},
	};
}

function renderer() {
	return { canvasRevision: ref(0), canvas: element(), histogramCanvas: element(), waveformHorizontalCanvas: element(), waveformVerticalCanvas: element() };
}

// 【モード・波形方向・Workerの交換に応じてCanvasを切り替える】
// Offscreen転送済みCanvasの複製や再転送をせず、非表示中に再生成した要素も表示できる必要がある。
test('selects the current canvas after mode, orientation and worker changes', async () => {
	const live = renderer();
	const timeline = renderer();
	const selected = shallowRef(live);
	const name = ref('waveformHorizontalCanvas');
	const target = element();
	const container = shallowRef(null);
	const scope = effectScope();
	scope.run(() => useRendererCanvas(container, selected, () => name.value));
	try {
		await nextTick();
		container.value = target;
		await nextTick();
		assert.deepEqual(target.children, [live.waveformHorizontalCanvas]);
		selected.value = timeline;
		await nextTick();
		assert.equal(live.waveformHorizontalCanvas.parentNode, null);
		assert.deepEqual(target.children, [timeline.waveformHorizontalCanvas]);
		name.value = 'waveformVerticalCanvas';
		await nextTick();
		assert.deepEqual(target.children, [timeline.waveformVerticalCanvas]);
		const previous = timeline.waveformVerticalCanvas;
		timeline.waveformVerticalCanvas = element();
		timeline.canvasRevision.value++;
		await nextTick();
		assert.equal(previous.parentNode, null);
		assert.deepEqual(target.children, [timeline.waveformVerticalCanvas]);
		live.waveformVerticalCanvas = element();
		live.canvasRevision.value++;
		selected.value = live;
		await nextTick();
		assert.deepEqual(target.children, [live.waveformVerticalCanvas]);
	} finally {
		scope.stop();
	}
	assert.deepEqual(target.children, []);
});

// 【別ウィンドウへ表示先を移した後の破棄で他の表示を消さない】
// detachやコンポーネントの再生成では、古いコンポーネントの後処理が遅れて走る場合がある。
test('moves between containers and only removes the canvas it still owns', async () => {
	const selected = shallowRef(renderer());
	const first = element();
	const second = element();
	const container = shallowRef(first);
	const scope = effectScope();
	scope.run(() => useRendererCanvas(container, selected, () => 'histogramCanvas'));
	await nextTick();
	container.value = second;
	await nextTick();
	assert.deepEqual(first.children, []);
	assert.deepEqual(second.children, [selected.value.histogramCanvas]);
	first.appendChild(selected.value.histogramCanvas);
	scope.stop();
	assert.deepEqual(first.children, [selected.value.histogramCanvas]);
});
