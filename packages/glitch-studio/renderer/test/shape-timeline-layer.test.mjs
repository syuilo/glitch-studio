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
const { getRendererLayerState } = await load('@gs/glitch-studio_shared/project/renderer-state.ts');
const { createTimelineCameraParameterValues } = await load('@gs/subsystems_timeline_shared/layers/camera/camera.ts');
const { createShape } = await load('@gs/subsystems_timeline_shared/layers/shape/shape.ts');
const { timelineCompositingParamDefs } = await load('@gs/subsystems_timeline_shared/timeline-compositing.ts');
const literal = value => ({ inputSource: 'literal', value });
const expression = expression => ({ inputSource: 'expression', expression });
const compositing = () => Object.fromEntries(Object.entries(timelineCompositingParamDefs).map(([key, def]) => [key, structuredClone(def.defaultValue)]));
const clip = (id, startMs, durationMs, contentOffsetMs = 0) => ({ id, startMs, durationMs, contentOffsetMs });
function layer(id, type = 'ellipse', values = {}) {
	const shape = createShape(type);
	Object.assign(shape.paramValues, values);
	return { id, name: id, layerType: 'shape', shape, isDisabled: false, forceDisableMotionBlur: false,
		clips: [clip('clip', 100, 1000, 20.5)], automationGraphs: [], compositingParamValues: compositing() };
}
function fixture(t, staticOptions = {}) {
	const calls = { draws: [], outputs: [], evaluations: [], submits: 0 };
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
					const isCompositing = code.includes('fn readTransformedSource(');
					const uniforms = isShape || isCompositing ? makeStructuredView(makeShaderDataDefinitions(code).uniforms.uniforms, groups[0].entries[0].resource.buffer.data).views : undefined;
					calls.draws.push({ isShape, isCompositing, uniforms, texture: descriptor.colorAttachments[0].view.texture });
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
	}, { timelineFps: 60, timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 16 }, enable32bitDataTextures: false, intermediateTextureFormat: 'rgba16float', ...staticOptions });
	const createLayer = manager.createTimelineLayer.bind(manager);
	manager.createTimelineLayer = (...args) => {
		const renderer = createLayer(...args);
		return { ...renderer, evaluate(context, signal) {
			calls.evaluations.push({ layerId: args[0].id, layerPath: args[2], context });
			return renderer.evaluate(context, signal);
		} };
	};
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
const near = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

// 【プレビュー・書き出しで固定レイヤーの内容と合成設定を揃え、設定変更時に境界を再収集する】
// レイヤー自身の生成値だけを止めてもCompositingが動けばぼける。逆に合成後の出力を
// 固定すると下層の動きが止まるため、実Managerの評価順とGPUへ渡す値を合わせて確認する。
test('freezes layer content and compositing in preview and export and refreshes cut boundaries after editing', async t => {
	for (const isExport of [false, true]) {
		const f = fixture(t, { timelineMotionBlur: { enabled: true, shutterAngle: 180, samples: 4 } });
		const background = layer('background', 'ellipse', { position: expression('[TIME, 0]') });
		background.clips = [clip('background', 0, 2000)];
		const foreground = layer('foreground', 'rectangle', { position: expression('[TIME, 0]') });
		foreground.forceDisableMotionBlur = true;
		foreground.compositingParamValues.position = expression('[TIME, 0]');
		await f.setup([foreground, background]);
		const render = time => isExport ? f.manager.renderTimelineFrame(time, 1000 / 60) : f.manager.renderTimelineAt(time);
		await render(99);
		assert.ok(f.calls.evaluations.some(call => call.context.sceneTimeMs > 100));
		assert.ok(f.calls.evaluations.every(call => call.layerId === 'background'));
		f.calls.evaluations.length = 0;
		f.calls.draws.length = 0;
		await render(100);
		assert.equal(f.calls.outputs.length, 2);
		const fixed = f.calls.evaluations.filter(call => call.layerId === 'foreground');
		assert.equal(fixed.length, 4);
		assert.ok(fixed.every(call => call.context.sceneTimeMs === 100 && call.context.contentTimeMs === 20.5));
		const moving = f.calls.evaluations.filter(call => call.layerId === 'background');
		assert.equal(new Set(moving.map(call => call.context.sceneTimeMs)).size, 4);
		assert.ok(moving[0].context.sceneTimeMs < 100 && moving.at(-1).context.sceneTimeMs > 100);
		const composites = f.calls.draws.filter(draw => draw.isCompositing);
		assert.equal(composites.length, 8);
		for (let index = 1; index < composites.length; index += 2) near(composites[index].uniforms.inverseX[2], -0.1);
		const edited = { ...foreground, forceDisableMotionBlur: false };
		f.manager.applyProjectChanges([{ type: 'layer', sceneId: 'scene', layerId: edited.id, layer: edited, changes: [{ type: 'motionBlur' }] }]);
		f.calls.evaluations.length = 0;
		await render(100);
		assert.ok(f.calls.evaluations.every(call => call.context.sceneTimeMs > 100));
		assert.equal(new Set(f.calls.evaluations.filter(call => call.layerId === 'foreground').map(call => call.context.sceneTimeMs)).size, 4);
	}
});

// 【グループと子Sceneの入れ子でも基準時刻を保ち、配置単位の強制無効を配下へ適用する】
// 親のサンプル時刻を子の基準時刻として使うと子のbooleanが効かなくなる。同じSceneの
// 別配置には影響させず、親グループの変形だけを動かす場合も子の内容は基準時刻に保つ。
test('propagates frame reference times through nested groups and trimmed scenes without changing other placements', async t => {
	const f = fixture(t, { timelineMotionBlur: { enabled: true, shutterAngle: 180, samples: 4 } });
	const fixed = layer('fixed');
	fixed.forceDisableMotionBlur = true;
	const moving = layer('moving');
	const group = (id, layers, forceDisableMotionBlur = false) => ({ id, name: id, layerType: 'group', layers,
		isDisabled: false, forceDisableMotionBlur, automationGraphs: [], compositingParamValues: compositing(), audioParamValues: { volume: literal(1) } });
	const child = { id: 'child', name: 'Child', resolution: { mode: 'project' }, layers: [group('inner', [fixed, moving])] };
	const placement = (id, forceDisableMotionBlur) => ({ id, name: id, layerType: 'scene', isDisabled: false, forceDisableMotionBlur,
		clips: [{ ...clip('clip', 100, 1000, 500), sceneId: 'child' }], automationGraphs: [],
		compositingParamValues: compositing(), audioParamValues: { volume: literal(1) } });
	const outer = group('outer', [placement('sampled', false)]);
	outer.compositingParamValues.position = expression('[TIME, 0]');
	const root = { id: 'scene', name: 'Root', resolution: { mode: 'project' }, layers: [outer, placement('frozen', true)] };
	await f.setup([], { timelineScenes: [root, child] });
	await f.manager.renderTimelineFrame(200, 1000 / 60);
	const childCalls = (placementId, layerId) => f.calls.evaluations.filter(call => call.layerId === layerId && call.layerPath.includes(placementId));
	assert.equal(childCalls('sampled', 'fixed').length, 4);
	assert.ok(childCalls('sampled', 'fixed').every(call => call.context.sceneTimeMs === 600));
	assert.equal(new Set(childCalls('sampled', 'moving').map(call => call.context.sceneTimeMs)).size, 4);
	assert.ok(childCalls('sampled', 'moving').every(call => call.context.referenceTime.sceneTimeMs === 600));
	assert.ok(childCalls('frozen', 'moving').every(call => call.context.sceneTimeMs === 600));
	assert.equal(new Set(f.calls.evaluations.filter(call => call.layerId === 'outer').map(call => call.context.sceneTimeMs)).size, 4);
	assert.equal(f.calls.outputs.length, 1);
	const edited = { ...outer, forceDisableMotionBlur: true };
	f.manager.applyProjectChanges([{ type: 'layer', sceneId: 'scene', layerId: 'outer', layer: getRendererLayerState(edited), changes: [{ type: 'motionBlur' }] }]);
	f.calls.evaluations.length = 0;
	await f.manager.renderTimelineFrame(200, 1000 / 60);
	assert.ok(childCalls('sampled', 'moving').every(call => call.context.sceneTimeMs === 600));
	assert.deepEqual(childCalls('sampled', 'moving').map(call => call.context.timeDelta), [1000 / 60, 0, 0, 0]);
	assert.ok(f.calls.evaluations.filter(call => call.layerId === 'outer').every(call => call.context.sceneTimeMs === 200));
	assert.equal(moving.forceDisableMotionBlur, false);
	assert.equal(child.layers[0].forceDisableMotionBlur, false);
});

// 【描画範囲を切り出してもScene高さの単位と輪郭配置を維持する】
// 画面外も描くためテクスチャ寸法は変わるが、形状・輪郭・回転の基準寸法は変えない。
// プレビュー倍率の二重適用とScene時刻の小数の喪失を防ぐ。
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
		assert.equal(draw.texture.format, 'rgba16float');
		assert.ok(draw.texture.width < 800 && draw.texture.height < 450);
		near(draw.uniforms.bounds[2] * 800 / draw.texture.width, 1, 0.01);
		near(draw.uniforms.position[0], 0.35025);
		near(draw.uniforms.halfSize[0], 0.3);
		near(draw.uniforms.halfSize[1], 0.15);
		near(draw.uniforms.cornerRadius[0], 0.15);
		near(draw.uniforms.rotation[0], Math.PI / 2);
		near(draw.uniforms.strokeInside[0], index * 0.01);
		near(draw.uniforms.strokeOutside[0], 0.02 - index * 0.01);
		near(draw.uniforms.pixelSize[0], draw.uniforms.bounds[3] / draw.texture.height);
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
	const updatedBackground = f.shapeDraws()[2].texture;
	assert.equal(backgroundDraw.texture.destroyed, true);
	assert.equal(updatedBackground.destroyed, false);
	const edited = structuredClone(foreground);
	edited.shape.paramValues.size = literal([0.2, 0.4]);
	f.update(edited);
	await f.manager.renderTimelineFrame(450, 0);
	assert.equal(foregroundDraw.texture.destroyed, true);
	assert.equal(updatedBackground.destroyed, false);
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
	assert.notEqual(f.calls.outputs.at(-1).texture, first.texture);
	assert.equal(f.calls.draws.length, 2);
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
	near(draw.uniforms.aspectRatio[0], 1.5);
	near(draw.uniforms.bounds[3] / draw.texture.height, 1 / 200);
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

// 【グループ設定の変更で子の描画履歴を捨てず、入れ子の枠を現在の変形で返す】
// 子はScene上のレイヤーとして直接編集できる。親の設定を閉じ込めた古いクロージャや、
// 根のレイヤーだけを調べる参照処理では、描画とハンドルが食い違う。
test('updates group transforms while retaining child resources and reporting ancestor geometry', async t => {
	const f = fixture(t);
	const group = (id, layers, position) => ({ id, name: id, layerType: 'group', isDisabled: false, layers, automationGraphs: [],
		compositingParamValues: { ...compositing(), position: literal(position) }, audioParamValues: { volume: literal(1) } });
	const child = layer('child');
	const inner = group('inner', [child], [0.2, 0.3]);
	const outer = group('outer', [inner], [-0.5, 0]);
	const previews = [];
	f.manager.on('ev', event => { if (event.type === 'layerTransform') previews.push(structuredClone(event.ctx)); });
	await f.setup([outer], { transformObserver: { sceneId: 'scene', layerId: 'child', requestId: 1 } });
	await f.manager.renderTimelineAt(200);
	const childTexture = f.shapeDraws()[0].texture;
	assert.equal(previews.at(-1).clipId, 'clip');
	assert.deepEqual(previews.at(-1).parentGeometries[0].matrix.map(value => Math.round(value * 1e6) / 1e6), [1, 0, 0, 1, -0.3, 0.3]);
	assert.deepEqual(previews.at(-1).geometry.sourceSize, { width: 800, height: 450 });
	const editedOuter = structuredClone(outer);
	editedOuter.compositingParamValues.position = literal([0.5, 0]);
	f.manager.applyProjectChanges([{ type: 'layer', sceneId: 'scene', layerId: 'outer', layer: getRendererLayerState(editedOuter),
		changes: [{ type: 'parameter', target: 'compositing', kind: 'value' }] }]);
	await f.manager.renderTimelineAt(200);
	assert.equal(childTexture.destroyed, false);
	assert.equal(f.shapeDraws().length, 1);
	assert.deepEqual(previews.at(-1).parentGeometries[0].matrix.map(value => Math.round(value * 1e6) / 1e6), [1, 0, 0, 1, 0.7, 0.3]);
	await f.manager.updateDynamicOptions({ transformObserver: { sceneId: 'scene', layerId: 'inner', requestId: 2 } });
	await f.manager.renderTimelineAt(200);
	assert.equal(previews.at(-1).clipId, null);
	assert.deepEqual(previews.at(-1).geometry.transform.position, [0.2, 0.3]);
	assert.equal(previews.at(-1).parentGeometries.length, 1);
	const disabled = { ...editedOuter, isDisabled: true };
	f.manager.applyProjectChanges([{ type: 'layer', sceneId: 'scene', layerId: 'outer', layer: getRendererLayerState(disabled), changes: [{ type: 'disabled' }] }]);
	await f.manager.renderTimelineAt(200);
	assert.equal(childTexture.destroyed, true);
	assert.equal(previews.at(-1).geometry, null);
});

// 【レイヤーを固定してもカメラのサブサンプル投影は止めない】
// カメラの値をレイヤーの基準時刻で評価するとカメラ移動のブラーが失われる。
// カメラ編集でも静止した形状のGPU資源を作り直さないことを同時に確認する。
test('samples camera motion independently of frozen layer content and keeps cached shapes on camera edits', async t => {
	const f = fixture(t, { timelineMotionBlur: { enabled: true, shutterAngle: 180, samples: 4 } });
	const entry = layer('fixed');
	entry.forceDisableMotionBlur = true;
	const camera = { id: 'camera', name: 'Camera', layerType: 'camera', clips: [clip('view', 0, 1000)], isDisabled: false, forceDisableMotionBlur: false, automationGraphs: [],
		cameraParamValues: { ...createTimelineCameraParameterValues(), position: expression('[TIME, 0]') } };
	await f.setup([camera, entry]);
	await f.manager.renderTimelineFrame(200, 1000 / 60);
	const texture = f.shapeDraws()[0].texture;
	assert.equal(f.shapeDraws().length, 1);
	const positions = f.calls.draws.filter(draw => draw.isCompositing).map(draw => draw.uniforms.inverseX[2]);
	assert.equal(new Set(positions).size, 4);
	assert.ok(positions[0] < 0.2 && positions.at(-1) > 0.2);
	f.manager.applyProjectChanges([{ type: 'layer', sceneId: 'scene', layerId: camera.id, changes: [{ type: 'parameter', target: 'camera', kind: 'value' }],
		layer: { ...camera, cameraParamValues: { ...camera.cameraParamValues, position: literal([0.4, 0]) } } }]);
	await f.manager.renderTimelineFrame(200, 0);
	assert.equal(f.shapeDraws().length, 1);
	assert.equal(texture.destroyed, false);
});
