import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { loadShaderSource } from './helpers/load-shader-source.mjs';

// GPUの呼び出しだけを記録し、Sceneの同期・評価・形状描画・合成は実コードを通す。
// ブラウザや実GPUの起動は不要。ピクセルの見た目そのものを検証するテストではない。
const globals = ['GPUQueue', 'GPUTextureUsage', 'GPUBufferUsage', 'GPUShaderStage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
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
const { createShape } = await load('@gs/subsystems_timeline_shared/layers/shape/shape.ts');
const { timelineCompositingParamDefs } = await load('@gs/subsystems_timeline_shared/timeline-compositing.ts');
const literal = value => ({ inputSource: 'literal', value });
const expression = expression => ({ inputSource: 'expression', expression });
const compositing = () => Object.fromEntries(Object.entries(timelineCompositingParamDefs).map(([key, def]) => [key, structuredClone(def.defaultValue)]));
const clip = (id, startMs, durationMs, contentOffsetMs = 0) => ({ id, startMs, durationMs, contentOffsetMs });
function layer(id, type = 'ellipse', values = {}) {
	const shape = createShape(type);
	Object.assign(shape.paramValues, values);
	return { id, name: id, layerType: 'shape', shape, isDisabled: false,
		clips: [clip('clip', 100, 1000, 20.5)], automationGraphs: [], compositingParamValues: compositing() };
}
function fixture(t) {
	const calls = { draws: [], outputs: [], submits: 0 };
	const texture = ({ size = [16, 16], format = 'rgba8unorm' } = {}) => ({
		width: size.width ?? size[0], height: size.height ?? size[1], format, destroyed: false,
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
					const isShape = code.includes('fn ellipseDistance(');
					const uniforms = isShape ? makeStructuredView(makeShaderDataDefinitions(code).uniforms.uniforms, groups[0].entries[0].resource.buffer.data).views : undefined;
					calls.draws.push({ isShape, uniforms, texture: descriptor.colorAttachments[0].view.texture });
				},
			};
		} }),
		queue: { submit() { calls.submits++; }, async onSubmittedWorkDone() {}, writeTexture() {},
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
		changes: [{ type: 'parameter', target: 'shape', kind: 'value' }] }]);
	return { manager, calls, setup, update, shapeDraws: () => calls.draws.filter(draw => draw.isShape) };
}
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);

// 【Scene高さの共通単位と輪郭配置を、倍率適用済みの固定解像度へ渡す】
// 形状の移動・回転でテクスチャ寸法が変わったり、プレビュー倍率を二重適用したりすると、
// レイヤーの合成設定との組み合わせが破綻する。Scene時刻の小数も保持する。
test('renders all stroke alignments at scene resolution and evaluates subframe scene time', async t => {
	const f = fixture(t);
	await f.setup(['inside', 'center', 'outside'].map(alignment => layer(alignment, 'rectangle', {
		position: expression('[TIME, 0]'), size: literal([0.6, 0.3]), rotation: literal(0.5),
		strokeEnabled: literal(true), strokeWidth: literal(0.02), strokeAlignment: literal(alignment), cornerRadius: literal(10),
	})));
	await f.manager.renderTimelineFrame(350.25, 0);
	const draws = f.shapeDraws();
	assert.equal(draws.length, 3);
	for (const [index, draw] of draws.entries()) {
		assert.deepEqual([draw.texture.width, draw.texture.height, draw.texture.format], [800, 450, 'rgba16float']);
		near(draw.uniforms.position[0], 0.35025);
		near(draw.uniforms.halfSize[0], 0.3);
		near(draw.uniforms.halfSize[1], 0.15);
		near(draw.uniforms.cornerRadius[0], 0.15);
		near(draw.uniforms.rotation[0], Math.PI / 2);
		near(draw.uniforms.strokeInside[0], index * 0.01);
		near(draw.uniforms.strokeOutside[0], 0.02 - index * 0.01);
		near(draw.uniforms.pixelSize[0], 1 / 450);
		near(draw.uniforms.aspectRatio[0], 1600 / 900);
	}
});

// 【静止シェイプを再利用しても背景は毎回合成し、編集対象だけを再生成する】
// シェイプと背景込みの出力を混同したキャッシュは、下層の動画・アニメーションを止める。
// 差分編集で無関係のレイヤーを破棄しないことも、実際のマネージャー経由で確認する。
test('caches geometry without freezing animated backgrounds and recreates only edited layers', async t => {
	const f = fixture(t);
	const foreground = layer('foreground');
	await f.setup([foreground, layer('background', 'rectangle', { rotation: expression('TIME') })]);
	await f.manager.renderTimelineFrame(350, 0);
	const [backgroundDraw, foregroundDraw] = f.shapeDraws();
	assert.equal(f.calls.draws.length, 4);
	await f.manager.renderTimelineFrame(450, 100);
	assert.equal(f.shapeDraws().length, 3);
	assert.equal(f.calls.draws.length, 7);
	assert.equal(f.shapeDraws()[2].texture, backgroundDraw.texture);
	const edited = structuredClone(foreground);
	edited.shape.paramValues.size = literal([0.2, 0.4]);
	f.update(edited);
	await f.manager.renderTimelineFrame(450, 0);
	assert.equal(foregroundDraw.texture.destroyed, true);
	assert.equal(backgroundDraw.texture.destroyed, false);
	assert.equal(f.shapeDraws().length, 4);
	const invalid = structuredClone(edited);
	invalid.shape.paramValues.size = { inputSource: 'layerInput' };
	assert.throws(() => f.update(invalid), /Layer input/);
	await f.manager.renderTimelineFrame(450, 0);
	assert.equal(f.shapeDraws().length, 4);
});

// 【空の形状もreplaceでは透明な素材として合成し、クリップ区間外では破棄する】
// 寸法0と区間外を同じ「出力なし」にするとreplaceで下層が残る。
// 隣接しない次のクリップは別の出力を持ち、内容オフセットにキーを引きずられない。
test('preserves transparent replace output and releases resources across clip gaps', async t => {
	const f = fixture(t);
	const entry = layer('shape', 'ellipse', { size: literal([0, 0.5]), position: expression('[TIME, 0]') });
	entry.clips = [clip('first', 100, 100), clip('second', 400, 100, 900)];
	entry.compositingParamValues.blendMode = literal('replace');
	await f.setup([entry]);
	await f.manager.renderTimelineFrame(150, 0);
	const first = f.shapeDraws()[0];
	assert.equal(first.uniforms.halfSize[0], 0);
	assert.equal(f.calls.outputs.at(-1).texture, first.texture);
	assert.equal(f.calls.draws.length, 1);
	await f.manager.renderTimelineFrame(200, 50);
	assert.equal(first.texture.destroyed, true);
	assert.equal(f.calls.outputs.at(-1).kind, 'uniform');
	await f.manager.renderTimelineFrame(450, 250);
	const second = f.shapeDraws()[1];
	assert.notEqual(second.texture, first.texture);
	near(second.uniforms.position[0], 0.45);
	f.manager.destroy();
	assert.equal(second.texture.destroyed, true);
});

// 【子Sceneのシェイプは子の寸法と時刻で描画する】
// 親のScene解像度や配置時刻を使うと、同じSceneを単独で開いた場合と見た目が異なる。
test('uses the owning child scene resolution and time when nested', async t => {
	const f = fixture(t);
	const child = { id: 'child', name: 'Child', resolution: { mode: 'customAbsolute', width: 600, height: 400 },
		layers: [layer('shape', 'ellipse', { position: expression('[TIME, 0]') })] };
	const parent = { id: 'scene', name: 'Parent', resolution: { mode: 'project' }, layers: [{
		id: 'nested', name: 'Nested', layerType: 'scene', clips: [{ ...clip('nested-clip', 100, 1000, 200), sceneId: 'child' }],
		isDisabled: false, automationGraphs: [], compositingParamValues: compositing(), audioParamValues: { volume: literal(1) },
	}] };
	await f.setup([], { timelineScenes: [parent, child] });
	await f.manager.renderTimelineFrame(350.25, 0);
	const draw = f.shapeDraws()[0];
	assert.deepEqual([draw.texture.width, draw.texture.height], [300, 200]);
	near(draw.uniforms.position[0], 0.45025);
});

// 【起点をまたぐ輪郭と進行率0・1を、通常の描画・キャッシュへ反映する】
// 起点だけの編集も描画に反映し、塗りのRGBAや輪郭配置には影響させない。
// 0と1はシェーダーへ明示して、空の輪郭と閉じた輪郭を同じ端点から区別する。
test('updates animated wrapped stroke intervals without changing fill or texture size', async t => {
	const f = fixture(t);
	const entry = layer('shape', 'ellipse', {
		size: literal([1, 1]), strokeEnabled: literal(true), strokeStart: literal(0.75), strokeProgress: expression('TIME'),
		fillColor: literal([0.5, 0.25, 0.75, 0.5]),
	});
	entry.clips = [clip('clip', 0, 2000, 800)];
	await f.setup([entry]);
	await f.manager.renderTimelineFrame(0, 0);
	const empty = f.shapeDraws().at(-1);
	assert.equal(empty.uniforms.strokeProgress[0], 0);
	await f.manager.renderTimelineFrame(500, 0);
	const partial = f.shapeDraws().at(-1);
	near(partial.uniforms.strokeProgress[0], 0.5);
	near(partial.uniforms.strokeStartPoint[0], -0.5);
	near(partial.uniforms.strokeStartPoint[1], 0);
	near(partial.uniforms.strokeEndPoint[0], 0.5);
	near(partial.uniforms.strokeEndPoint[1], 0);
	near(partial.uniforms.strokeSweepAngle[0], Math.PI);
	assert.deepEqual(Array.from(partial.uniforms.fillColor), [0.5, 0.25, 0.75, 0.5]);
	assert.equal(partial.texture, empty.texture);
	await f.manager.renderTimelineFrame(1000, 0);
	assert.equal(f.shapeDraws().at(-1).uniforms.strokeProgress[0], 1);
	const edited = structuredClone(entry);
	edited.shape.paramValues.strokeStart = literal(1);
	f.update(edited);
	await f.manager.renderTimelineFrame(500, 0);
	const wrapped = f.shapeDraws().at(-1);
	near(wrapped.uniforms.strokeStartPoint[0], 0);
	near(wrapped.uniforms.strokeStartPoint[1], 0.5);
	near(wrapped.uniforms.strokeEndPoint[0], 0);
	near(wrapped.uniforms.strokeEndPoint[1], -0.5);
});
