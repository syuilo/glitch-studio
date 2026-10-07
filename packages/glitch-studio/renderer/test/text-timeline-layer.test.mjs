import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { loadShaderSource } from './helpers/load-shader-source.mjs';

// GPUとCanvasの呼び出しを記録し、Sceneの同期・評価・文字の配置・合成は実コードを通す。
// ブラウザや実GPUの起動は不要。ピクセルの見た目そのものを検証するテストではない。
const globals = ['GPUQueue', 'GPUTextureUsage', 'GPUBufferUsage', 'GPUShaderStage', 'OffscreenCanvas'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
const gpu = Object.getOwnPropertyDescriptor(navigator, 'gpu');
globalThis.GPUQueue = class { submit() {} };
globalThis.GPUTextureUsage = { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2, COPY_DST: 4 };
globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2 };
globalThis.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
Object.defineProperty(navigator, 'gpu', { configurable: true, value: { getPreferredCanvasFormat: () => 'rgba8unorm' } });
after(() => {
	for (const [key, descriptor] of globals) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else delete globalThis[key];
	}
	if (gpu) Object.defineProperty(navigator, 'gpu', gpu);
	else delete navigator.gpu;
});

const load = path => loadShaderSource(fileURLToPath(import.meta.resolve(path)));
const { TimelineRendererManager } = await load('../src/timeline-renderer-manager.ts');
const { createVoicevoxSubtitleParameterValues } = await load('@gs/subsystems_timeline_shared/layers/voicevox/voicevox-subtitle.ts');
const { createTextParameterValues } = await load('@gs/subsystems_timeline_shared/layers/text/text.ts');
const { timelineCompositingParamDefs } = await load('@gs/subsystems_timeline_shared/timeline-compositing.ts');
const literal = value => ({ inputSource: 'literal', value });
const expression = expression => ({ inputSource: 'expression', expression });
const compositing = () => Object.fromEntries(Object.entries(timelineCompositingParamDefs).map(([key, def]) => [key, structuredClone(def.defaultValue)]));
const clip = (id, startMs, durationMs, contentOffsetMs = 0) => ({ id, startMs, durationMs, contentOffsetMs });
function layer(id, values = {}) {
	const textParamValues = { ...createTextParameterValues(), ...values };
	return { id, name: id, layerType: 'text', textParamValues, isDisabled: false,
		clips: [clip('clip', 100, 1000, 20.5)], automationGraphs: [], compositingParamValues: compositing() };
}
function fixture(t) {
	const calls = { draws: [], outputs: [], submits: 0, uploads: [], glyphs: [] };
	globalThis.OffscreenCanvas = class {
		constructor(width, height) { this.width = width; this.height = height; }
		getContext() {
			return { canvas: this, font: '', clearRect() {}, save() {}, restore() {}, translate() {}, scale() {}, drawImage() {},
				fillText(text) { calls.glyphs.push({ text, font: this.font }); }, strokeText() {},
				measureText(text) {
					const size = Number.parseFloat(this.font);
					return { width: text.length * size * 0.5, actualBoundingBoxLeft: 0, actualBoundingBoxRight: text.length * size * 0.5,
						actualBoundingBoxAscent: size * 0.8, actualBoundingBoxDescent: size * 0.2, fontBoundingBoxAscent: size * 0.8, fontBoundingBoxDescent: size * 0.2 };
				},
			};
		}
	};
	const texture = ({ size = [16, 16], format = 'rgba8unorm' } = {}) => ({
		width: size.width ?? size[0], height: size.height ?? size[1], format, depthOrArrayLayers: size.depthOrArrayLayers ?? 1, destroyed: false,
		createView() { return { texture: this }; }, destroy() { this.destroyed = true; },
	});
	const device = {
		limits: { maxTextureDimension2D: 8192 }, features: new Set(), destroy() {},
		createTexture: texture, createBuffer: ({ size }) => ({ size, destroy() { this.destroyed = true; } }),
		createShaderModule: descriptor => descriptor, createSampler: () => ({}), createBindGroup: descriptor => descriptor,
		createBindGroupLayout: () => ({}), createPipelineLayout: () => ({}),
		createRenderPipeline: descriptor => ({ ...descriptor, getBindGroupLayout: () => ({}) }), createComputePipeline: () => ({}),
		createCommandEncoder: () => ({ finish: () => ({}), beginRenderPass(descriptor) {
			let pipeline;
			const groups = [];
			return { setPipeline(value) { pipeline = value; }, setBindGroup(index, value) { groups[index] = value; }, end() {},
				draw() {
					const code = pipeline.fragment.module.code;
					const isText = code.includes('var maskTexture:');
					const uniforms = isText ? makeStructuredView(makeShaderDataDefinitions(code).uniforms.gs_inputs, groups[1].entries[0].resource.buffer.data).views : undefined;
					calls.draws.push({ isText, uniforms, texture: descriptor.colorAttachments[0].view.texture });
				},
			};
		} }),
		queue: { submit() { calls.submits++; }, async onSubmittedWorkDone() {}, writeTexture() {}, copyExternalImageToTexture(source, destination) { calls.uploads.push(destination); },
			writeBuffer(buffer, _offset, data) { buffer.data = data.slice(0); },
		},
	};
	const manager = new TimelineRendererManager({
		gpuDevice: device, gpuContext: { canvas: { width: 16, height: 16 }, configure() {}, getCurrentTexture: texture },
		effectDefinitions: {}, effectImplementations: {},
	}, { timelineFps: 60, timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 16 }, enable32bitDataTextures: false, intermediateTextureFormat: 'rgba16float' });
	manager.presentOutput = output => calls.outputs.push(output);
	t.after(() => manager.destroy());
	const setup = (layers, extra = {}) => manager.updateDynamicOptions({
		timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers }], sceneId: 'scene',
		resolution: { width: 1600, height: 900 }, resolutionScale: 0.5, ...extra,
	});
	const update = entry => manager.applyProjectChanges([{ type: 'layer', sceneId: 'scene', layerId: entry.id, layer: entry,
		changes: [{ type: 'parameter', target: 'text', kind: 'value' }] }]);
	return { manager, calls, setup, update, textDraws: () => calls.draws.filter(draw => draw.isText) };
}
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);

// 【VOICEVOXの字幕は音声生成や再生履歴によらずScene時刻で決まる】
// 未生成でも本文を描画し、最初のキー前と空文字キー以降は前の字幕を残さない。
test('renders VOICEVOX subtitles at scene time without requiring generated audio', async t => {
	const f = fixture(t);
	const speech = { id: 'speech', name: 'Speech', isDisabled: false, automationGraphs: [],
		clips: [clip('speech-clip', 100, 1000, 20.5)], compositingParamValues: compositing(), subtitleParamValues: createVoicevoxSubtitleParameterValues(), layerType: 'voicevox', voicevox: { speedScale: 1 },
		utterances: [{ id: 'first', timeMs: 300, text: 'Speech subtitle', reading: '別の読み', styleId: 1 }, { id: 'clear', timeMs: 600, text: '', reading: null, styleId: 1 }],
		audioParamValues: { volume: literal(1) } };
	await f.setup([speech]);
	await f.manager.renderTimelineFrame(200, 0);
	assert.deepEqual(f.calls.glyphs.map(glyph => glyph.text), ['']);
	await f.manager.renderTimelineFrame(350, 0);
	assert.equal(f.calls.glyphs.at(-1).text, 'Speech subtitle');
	await f.manager.renderTimelineFrame(600, 0);
	assert.equal(f.calls.glyphs.at(-1).text, '');
	await f.manager.renderTimelineFrame(350, 0);
	assert.equal(f.calls.glyphs.at(-1).text, 'Speech subtitle');
});

// 【TextをScene解像度で描画し、本文と色をScene時刻で評価する】
// 倍率の二重適用と内容オフセットによる時刻ずれを防ぎ、半透明色は一度だけpremultiplyする。
test('renders text at scene resolution with scene-time expressions and premultiplied colors', async t => {
	const f = fixture(t);
	await f.setup([layer('text', { text: expression('TIME_MS'), color: literal([0.8, 0.4, 0.2, 0.5]),
		outlineWidth: literal(0.05), shadowEnabled: literal(true) })]);
	await f.manager.renderTimelineFrame(350.25, 0);
	const draw = f.textDraws()[0];
	assert.deepEqual([draw.texture.width, draw.texture.height, draw.texture.format], [800, 450, 'rgba16float']);
	assert.equal(f.calls.glyphs[0].text, '350.25');
	assert.equal(f.calls.glyphs[0].font, '45px sans-serif');
	for (const [index, value] of [0.4, 0.2, 0.1, 0.5].entries()) near(draw.uniforms.value_color[index], value);
	assert.deepEqual(f.calls.uploads.map(upload => upload.origin.z), [0, 1, 2]);
});

// 【Textのマスクを再利用しても色と下層の合成は更新する】
// 色だけのアニメーションでCanvasを再描画せず、静止Textのキャッシュで背景を凍結させない。
test('reuses glyph masks for animated colors and recreates only edited layers', async t => {
	const f = fixture(t);
	const foreground = layer('foreground');
	await f.setup([foreground, layer('background', { color: expression('[TIME, 0, 0, 1]') })]);
	await f.manager.renderTimelineFrame(350, 0);
	const [background, front] = f.textDraws();
	assert.equal(f.calls.uploads.length, 2);
	assert.equal(f.calls.draws.length, 4);
	await f.manager.renderTimelineFrame(450, 100);
	assert.equal(f.textDraws().length, 3);
	assert.equal(f.calls.draws.length, 7);
	assert.equal(f.calls.uploads.length, 2);
	const edited = structuredClone(foreground);
	edited.textParamValues.text = literal('Edited');
	f.update(edited);
	await f.manager.renderTimelineFrame(450, 0);
	assert.equal(front.texture.destroyed, true);
	assert.equal(background.texture.destroyed, false);
	assert.equal(f.textDraws().length, 4);
	const invalid = structuredClone(edited);
	invalid.textParamValues.color = { inputSource: 'layerInput' };
	assert.throws(() => f.update(invalid), /Layer input/);
});

// 【空のTextもreplaceで合成し、区間外ではGPUリソースを解放する】
// 空文字とクリップ不在を同一視するとreplaceの透明出力を失い、隣接しないクリップへ状態が残る。
test('keeps transparent replace output and releases resources across clip gaps', async t => {
	const f = fixture(t);
	const entry = layer('text', { text: literal(''), size: literal(0) });
	entry.clips = [clip('first', 100, 100), clip('second', 400, 100, 900)];
	entry.compositingParamValues.blendMode = literal('replace');
	await f.setup([entry]);
	await f.manager.renderTimelineFrame(150, 0);
	const first = f.textDraws()[0];
	const mask = f.calls.uploads[0].texture;
	assert.equal(f.calls.outputs.at(-1).texture, first.texture);
	assert.equal(f.calls.glyphs.length, 0);
	await f.manager.renderTimelineFrame(200, 50);
	assert.equal(first.texture.destroyed, true);
	assert.equal(mask.destroyed, true);
	assert.equal(f.calls.outputs.at(-1).kind, 'uniform');
	await f.manager.renderTimelineFrame(450, 250);
	const second = f.textDraws()[1];
	assert.notEqual(second.texture, first.texture);
	f.manager.destroy();
	assert.equal(second.texture.destroyed, true);
});

// 【子SceneのTextは子の時刻と寸法を使う】
// 親のタイムライン上へ配置しても、子Sceneを単独で編集した場合と同じテキストを生成する。
test('uses child scene time and resolution when nested', async t => {
	const f = fixture(t);
	const child = { id: 'child', name: 'Child', resolution: { mode: 'customAbsolute', width: 600, height: 400 },
		layers: [layer('text', { text: expression('TIME_MS') })] };
	const parent = { id: 'scene', name: 'Parent', resolution: { mode: 'project' }, layers: [{
		id: 'nested', name: 'Nested', layerType: 'scene', clips: [{ ...clip('nested-clip', 100, 1000, 200), sceneId: 'child' }],
		isDisabled: false, automationGraphs: [], compositingParamValues: compositing(), audioParamValues: { volume: literal(1) },
	}] };
	await f.setup([], { timelineScenes: [parent, child] });
	await f.manager.renderTimelineFrame(350.25, 0);
	const draw = f.textDraws()[0];
	assert.deepEqual([draw.texture.width, draw.texture.height], [300, 200]);
	assert.equal(f.calls.glyphs[0].text, '450.25');
});
