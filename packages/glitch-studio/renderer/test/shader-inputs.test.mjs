import { createEffectInstance } from '@gs/subsystems_effect-new_renderer/create-effect-instance.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadShaderSource } from './helpers/load-shader-source.mjs';

globalThis.GPUShaderStage = { FRAGMENT: 2, COMPUTE: 4 };
globalThis.GPUBufferUsage = { UNIFORM: 64, COPY_DST: 8 };
globalThis.GPUTextureUsage = { TEXTURE_BINDING: 4, COPY_DST: 2, RENDER_ATTACHMENT: 16 };
globalThis.GPUQueue = class { submit() {} };

const load = path => loadShaderSource(fileURLToPath(import.meta.resolve(path)));
const { constantShaderInput, textureShaderInput, inputUvScale } = await load('@gs/shared/gpu/shader-input.ts');
const { default: effect } = await load('@gs/subsystems_effect-new_native-effects/fx/colorMix/_impl_.ts');
const { default: definition } = await load('@gs/subsystems_effect-new_native-effects/fx/colorMix/_def_.ts');
const { default: imageEffect } = await load('@gs/subsystems_effect-new_native-effects/fx/image/_impl_.ts');
const { default: imageDefinition } = await load('@gs/subsystems_effect-new_native-effects/fx/image/_def_.ts');
const { default: videoEffect } = await load('@gs/subsystems_effect-new_native-effects/fx/video/_impl_.ts');
const { default: videoDefinition } = await load('@gs/subsystems_effect-new_native-effects/fx/video/_def_.ts');
const { UniformOrTextureToTextureResolver } = await load('@gs/shared/gpu/uniform-or-texture-to-texture-resolver.ts');
const { toShaderInput } = await load('@gs/shared/gpu/shader-input.ts');
const { TimelineRenderer } = await load('@gs/subsystems_timeline_renderer/timeline-renderer.ts');
import { createTimelineEffectProbe } from './helpers/timeline-effect-probe.mjs';
const { createTimelineCompositor, getTimelinePlacement } = await load('@gs/subsystems_timeline_renderer/timeline-compositor.ts');
const { createSceneOutput } = await load('@gs/subsystems_timeline_renderer/scene-output.ts');
const { createImageTimelineLayer } = await load('@gs/subsystems_timeline_renderer/layers/image/image-timeline-layer.ts');
const { createMotionBlurAccumulator } = await load('@gs/subsystems_timeline_renderer/motion-blur-accumulator.ts');

// 【モーションブラーは浮動小数点の平均を保持し、読み書きを別テクスチャへ分ける】
// 8bit蓄積による階調劣化・同一パスの読み書き競合・借用入力の破棄を防ぐ。
// GPU実行ではなく、実際のpipeline・binding構築を通して資源の契約を検証する。
test('accumulates motion blur using separate floating point targets and normalized weights', () => {
	for (const enable32bitDataTextures of [false, true]) {
		const { device, calls } = gpuFixture();
		const passes = [];
		const encoder = { beginRenderPass(descriptor) {
			const pass = { descriptor, groups: [], setPipeline(pipeline) { this.pipeline = pipeline; }, setBindGroup(index, group) { this.groups[index] = group; }, draw() {}, end() {} };
			passes.push(pass);
			return pass;
		} };
		const accumulator = createMotionBlurAccumulator({ device, vertex: {}, resolution: { width: 20, height: 10 }, enable32bitDataTextures });
		const source = device.createTexture({ size: [20, 10], format: 'rgba8unorm' });
		const outputs = [];
		for (const index of [0, 1, 2, 0]) {
			outputs.push(accumulator.add(encoder, index === 0 ? { kind: 'uniform', value: [0.5, 0, 0, 0.5] } : { kind: 'texture', texture: source }, index));
		}
		assert.equal(calls.textures.length, 3);
		assert.equal(outputs[0].texture, outputs[2].texture);
		assert.equal(outputs[0].texture, outputs[3].texture);
		assert.notEqual(outputs[0].texture, outputs[1].texture);
		for (const pass of passes) {
			const format = enable32bitDataTextures ? 'rgba32float' : 'rgba16float';
			assert.equal(pass.pipeline.fragment.targets[0].format, format);
			assert.equal(pass.pipeline.fragment.targets[0].blend, undefined);
			const target = pass.descriptor.colorAttachments[0].view.texture;
			assert.equal(target.format, format);
			assert.notEqual(target, pass.groups[0].entries[0].resource.texture);
		}
		assert.deepEqual(calls.writes.filter(values => values.length === 1).map(values => values[0]), [1, 0.5, Math.fround(1 / 3), 1]);
		accumulator.dispose();
		assert.ok(calls.textures.slice(0, 2).every(texture => texture.destroyed));
		assert.equal(source.destroyed, false);
		assert.ok(calls.buffers.every(buffer => buffer.destroyed));
	}
});

function gpuFixture() {
	const calls = { textures: [], buffers: [], shaders: [], groups: [], samplers: [], writes: [], externalCopies: [], draws: 0, uploads: 0 };
	const device = {
		limits: { maxTextureDimension2D: 8192 },
		createTexture(options) {
			const size = options.size;
			const texture = { width: size.width ?? size[0], height: size.height ?? size[1], format: options.format, destroyed: false, createView() { return { texture }; }, destroy() { this.destroyed = true; } };
			calls.textures.push(texture);
			return texture;
		},
		createBuffer(options) {
			const buffer = { ...options, destroyed: false, destroy() { this.destroyed = true; } };
			calls.buffers.push(buffer);
			return buffer;
		},
		createBindGroupLayout: options => options,
		createPipelineLayout: options => options,
		createRenderPipeline: options => ({ ...options, getBindGroupLayout: () => ({}) }),
		createShaderModule(options) { calls.shaders.push(options.code); return options; },
		createBindGroup(options) { calls.groups.push(options); return options; },
		createSampler(options) { calls.samplers.push(options); return options; },
		queue: {
			writeBuffer(buffer, offset, values) { calls.writes.push(new Float32Array(values)); },
			writeTexture() { calls.uploads++; },
			copyExternalImageToTexture(source) { calls.externalCopies.push(source.source); },
			submit() {},
		},
	};
	const encoder = { beginRenderPass: () => ({ setPipeline() {}, setBindGroup() {}, draw() { calls.draws++; }, end() {} }), finish: () => ({}) };
	device.createRenderPipelineAsync = async options => device.createRenderPipeline(options);
	device.createCommandEncoder = () => encoder;
	return { device, calls, encoder };
}
const literal = value => ({ inputSource: 'literal', value });

// 【Playerのフレーム消失では透明にし、復旧した映像でキャッシュを更新する】
// 初回到着待ちと取得失敗を同じnull入力として扱い、準備・描画を継続する。
// 実際のVideo実装を通し、取得不能の間に古い映像が残らず、復旧時に設定の再編集も不要なことを確認する。
test('keeps rendering transparent video while player frames are missing and resumes after recovery', async t => {
	const { device, calls } = gpuFixture();
	const passes = [];
	const encoder = { beginRenderPass(descriptor) {
		passes.push(descriptor);
		return { setPipeline() {}, setBindGroup() {}, draw() { calls.draws++; }, end() {} };
	} };
	const videoTextures = new Map();
	const renderer = await place(device, native('video'), { resolution: { width: 16, height: 9 }, staticSettings: { player: 'player' }, params: { fit: literal('stretch') },
		resources: { assets: [], assetTextures: new Map(), getPlayerVideoTexture: id => videoTextures.get(id) ?? null } });
	t.after(() => renderer.dispose());
	const render = async () => {
		const frame = shaderFrame(); await renderer.prepare(frame); renderer.render(frame, encoder); return renderer.outputs.get('output');
	};
	const assertTransparent = () => {
		assert.equal(passes.at(-1).colorAttachments[0].loadOp, 'clear');
		assert.deepEqual(Object.values(passes.at(-1).colorAttachments[0].clearValue ?? [0, 0, 0, 0]), [0, 0, 0, 0]);
	};
	await render();
	assertTransparent();
	const first = { texture: device.createTexture({ size: [16, 9] }), displayResolution: { width: 16, height: 9 } };
	videoTextures.set('player', first);
	await render();
	assert.deepEqual(calls.externalCopies, []);
	assert.equal(calls.draws, 1);
	videoTextures.delete('player');
	await render();
	assertTransparent();
	assert.equal(calls.draws, 1);
	const recovered = { texture: device.createTexture({ size: [16, 9] }), displayResolution: { width: 16, height: 9 } };
	videoTextures.set('player', recovered);
	const output = await render();
	assert.deepEqual(calls.externalCopies, []);
	assert.equal(calls.draws, 2);
	assert.deepEqual([output.texture.width, output.texture.height], [16, 9]);
});

// 【マスク画像の取得中に中断した合成は、GPUへ新たなコマンドを送信しない】
// 遅延解決が終わった直後にも中断を確認し、古いシークの合成によるテクスチャ上書きを防ぐ。
test('cancels compositing while awaiting a referenced mask image', async () => {
	const { device, calls } = gpuFixture();
	let submissions = 0;
	device.queue.submit = () => { submissions++; };
	const compositor = createTimelineCompositor({ device, vertex: {}, resolution: { width: 8, height: 4 } });
	let resolveMask;
	const mask = new Promise(resolve => { resolveMask = resolve; });
	const source = { kind: 'uniform', value: [1, 0, 0, 1] };
	const settings = { mask: null, layerMask: { sourceLayerId: 'source', channel: 'alpha', inverted: false }, coordinateSpace: 'screen',
		blendMode: 0, opacity: 1, fitMode: 'contain', position: [0, 0], origin: [0, 0], scale: [1, 1], rotation: 0, depth: 0 };
	const controller = new AbortController();
	try {
		const result = compositor.evaluate({ getLayerOutput: () => mask }, source, settings);
		assert.equal(result.source, source);
		const pending = result.composite({ kind: 'uniform', value: [0, 0, 0, 0] }, controller.signal);
		controller.abort();
		resolveMask(source);
		await assert.rejects(pending, { name: 'AbortError' });
		assert.equal(calls.draws, 0);
		assert.equal(submissions, 0);
	} finally { compositor.dispose(); }
});

// 【画像レイヤーの素材寸法へ倍率を一度だけ適用し、縮小結果だけを所有する】
// 無変形replaceで素材が直接後段へ流れても、原寸がプレビューへ漏れたり二重縮小されたりしない。
// 再評価で縮小パスを繰り返さないことと、破棄時に共有Assetテクスチャを壊さないことも確認する。
// GPUの画素検証ではなく、実際の合成・入力bindingを通してリソースと描画回数の契約を検証する。
test('scales image layer sources once and preserves borrowed asset textures', async () => {
	for (const resolutionScale of [0.5, 1]) {
		const { device, calls, encoder } = gpuFixture();
		device.createCommandEncoder = () => encoder;
		encoder.finish = () => ({});
		let submissions = 0;
		device.queue.submit = () => { submissions++; };
		const source = device.createTexture({ size: [3840, 2160], format: 'rgba8unorm' });
		const layer = { compositingParamValues: { blendMode: literal('replace') }, automationGraphs: [] };
		const renderer = createImageTimelineLayer(layer, source, {
			device, vertex: {}, resolution: { width: 1920 * resolutionScale, height: 1080 * resolutionScale }, resolutionScale
		});
		const background = { kind: 'uniform', value: [0, 0, 0, 0] };
		const context = { sceneTimeMs: 0, contentTimeMs: 0, contentEndTimeMs: 5000, clipElapsedTimeMs: 0, clipDurationMs: 5000, isExport: resolutionScale === 1 };
		const signal = new AbortController().signal;
		const first = await (await renderer.evaluate(context, signal)).composite(background, signal);
		const second = await (await renderer.evaluate({ ...context, sceneTimeMs: 1000, contentTimeMs: 1000, clipElapsedTimeMs: 1000 }, signal)).composite(background, signal);
		assert.equal(first.texture, second.texture);
		assert.deepEqual([first.texture.width, first.texture.height], [3840 * resolutionScale, 2160 * resolutionScale]);
		assert.equal(calls.draws, resolutionScale === 1 ? 0 : 1);
		assert.equal(calls.textures.length, resolutionScale === 1 ? 1 : 2);
		if (resolutionScale === 1) assert.equal(first.texture, source);
		else assert.equal(first.texture.format, 'rgba16float');
		assert.equal(submissions, 4);
		await renderer.evaluate(context, AbortSignal.abort());
		assert.equal(submissions, 4);
		renderer.destroy();
		assert.equal(source.destroyed, false);
		assert.ok(calls.textures.filter(texture => texture !== source).every(texture => texture.destroyed));
		assert.ok(calls.buffers.every(buffer => buffer.destroyed));
		await renderer.evaluate(context, signal);
		assert.equal(submissions, 4);
	}
});

// 【異なる解像度の素材は元テクスチャを直接読み、replaceでもfitを省略しない】
// 先に出力解像度へ縮小すると拡大時に細部を失い、借用出力を返すだけではcontainが消える。
// GPUは使わず、実際のbindingと描画先のサイズから転送・合成の契約を確認する。
test('composites native-resolution sources with the selected fit before replacing the output', () => {
	const { device, calls, encoder } = gpuFixture();
	const texture = device.createTexture({ size: [3840, 2160], format: 'rgba16float' });
	const source = { kind: 'texture', texture };
	const compositor = createTimelineCompositor({ device, vertex: {}, resolution: { width: 100, height: 100 } });
	const settings = { blendMode: 19, opacity: 1, fitMode: 'contain', position: [0, 0], origin: [0, 0], scale: [1, 1], rotation: 0 };
	const background = { kind: 'uniform', value: [0, 0, 0, 0] };
	const contained = compositor.render(encoder, background, source, settings);
	assert.notEqual(contained, source);
	assert.deepEqual([contained.texture.width, contained.texture.height], [100, 100]);
	assert.deepEqual([calls.writes.at(-2)[0], calls.writes.at(-2)[5]], [1, Math.fround(3840 / 2160)]);
	compositor.render(encoder, background, source, { ...settings, fitMode: 'cover', scale: [0.5, 0.5] });
	assert.deepEqual([calls.writes.at(-2)[0], calls.writes.at(-2)[5]], [2 * 2160 / 3840, 2]);
	assert.ok(calls.groups.some(group => group.entries.some(entry => entry.resource.texture === texture)));
	assert.deepEqual(calls.textures.map(texture => [texture.width, texture.height]), [[3840, 2160], [100, 100]]);
	compositor.dispose();
	assert.equal(texture.destroyed, false);
});

// 【StretchのReplaceで素材を借用しても、親にはScene基準の配置済み画像として渡す】
// 縦横比の違う素材を返すだけでは、親のContainで子のStretchが取り消される。
// 元のGPUテクスチャは維持しつつ、親が使う論理寸法だけをSceneへ切り替える。
test('keeps stretched replace outputs in scene coordinates without copying the source texture', () => {
	const { device, calls, encoder } = gpuFixture();
	const resolution = { width: 8, height: 4 };
	const compositor = createTimelineCompositor({ device, vertex: {}, resolution });
	const source = { kind: 'texture', texture: device.createTexture({ size: [16, 16], format: 'rgba16float' }) };
	const background = { kind: 'uniform', value: [0, 0, 0, 0] };
	const settings = { blendMode: 19, opacity: 1, fitMode: 'stretch', position: [0, 0], origin: [0, 0], scale: [1, 1], rotation: 0, depth: 0 };
	const output = compositor.render(encoder, background, source, settings);
	assert.equal(output.texture, source.texture);
	assert.equal(source.region, undefined);
	assert.deepEqual(output.region, { bounds: { left: -1, bottom: -1, right: 1, top: 1 }, frameSize: resolution });
	assert.deepEqual(getTimelinePlacement(output, resolution, { ...settings, fitMode: 'contain' }), [1, 0, 0, 1, 0, 0]);
	assert.equal(calls.draws, 0);
	assert.equal(calls.textures.length, 1);
	compositor.dispose();
	assert.equal(source.texture.destroyed, false);
});

// 【ノード入力は同じ縦横比でもSceneの宣言寸法へ揃える】
// EffectとCustom Node Graph EffectはTimelineのregionを知らないため、正方形の物理テクスチャを
// 横長の合成結果としてそのまま渡すと入力サンプリングで再びFitされてしまう。
// 定数と確定済み画像では、空のencoder作成・GPU送信も省く必要がある。
test('normalizes node inputs to declared scene dimensions while borrowing already matching frames', () => {
	const { device, calls, encoder } = gpuFixture();
	let encoders = 0, submissions = 0;
	device.createCommandEncoder = () => { encoders++; return encoder; };
	encoder.finish = () => ({});
	device.queue.submit = () => { submissions++; };
	const resolution = { width: 8, height: 4 };
	const output = createSceneOutput({ device, vertex: {}, resolution });
	const region = { bounds: { left: -1, bottom: -1, right: 1, top: 1 }, frameSize: resolution };
	const matching = { kind: 'texture', texture: device.createTexture({ size: [8, 4], format: 'rgba16float' }), region };
	assert.equal(output.renderInput(matching), matching);
	assert.equal(calls.draws, 0);
	assert.equal(encoders, 0);
	assert.equal(submissions, 0);
	const native = { kind: 'texture', texture: device.createTexture({ size: [16, 8], format: 'rgba16float' }), region };
	const framed = output.renderInput(native);
	assert.deepEqual([framed.texture.width, framed.texture.height], [8, 4]);
	assert.equal(calls.draws, 1);
	const stretched = { kind: 'texture', texture: device.createTexture({ size: [16, 16], format: 'rgba16float' }), region };
	const normalized = output.renderInput(stretched);
	assert.notEqual(normalized.texture, stretched.texture);
	assert.deepEqual([normalized.texture.width, normalized.texture.height], [8, 4]);
	assert.equal(calls.draws, 2);
	assert.equal(encoders, 2);
	assert.equal(submissions, 2);
	output.dispose();
	assert.equal(matching.texture.destroyed, false);
	assert.equal(stretched.texture.destroyed, false);
});

// 【平面化グループの画面外領域が増えても背景のFitを再計算しない】
// 描画先が横に広がったときにCoverで背景を読み直すと、静止した背景の上下が切れる。
// 実際の入力bindingへ渡すUV倍率を調べ、描画先の物理比率が背景へ混入しないことを保証する。
test('keeps background sampling unchanged when the composite bounds expand', () => {
	const { device, calls, encoder } = gpuFixture();
	const compositor = createTimelineCompositor({ device, vertex: {}, resolution: { width: 8, height: 4 } });
	const background = { kind: 'texture', texture: device.createTexture({ size: [8, 4], format: 'rgba16float' }) };
	const settings = { blendMode: 0, opacity: 1, fitMode: 'contain', position: [1, 0], origin: [0, 0], scale: [1, 1], rotation: 0, depth: 0 };
	const output = compositor.render(encoder, background, { kind: 'texture', texture: { width: 8, height: 4, createView: () => ({}) } }, settings, { parent: [1, 0, 0, 1, 0, 0], depth: 0 });
	assert.deepEqual([output.texture.width, output.texture.height], [16, 4]);
	assert.deepEqual([...calls.writes.at(-1).slice(4, 6)], [1, 1]);
	compositor.dispose();
});

// 【マスク素材の大きさや位置で下層の描画領域を拡張しない】
// Groupを親でfitするときの枠・原点・画素密度が、切り抜く図形の移動で変わることを防ぐ。
test('preserves background bounds and frame size when applying an oversized mask', () => {
	const { device, encoder } = gpuFixture();
	const resolution = { width: 8, height: 4 };
	const compositor = createTimelineCompositor({ device, vertex: {}, resolution });
	const region = { bounds: { left: -2, right: 3, bottom: -1, top: 2 }, frameSize: resolution };
	const background = { kind: 'texture', texture: { width: 8, height: 4, createView: () => ({}) }, region };
	const settings = { mask: { channel: 'alpha', inverted: false }, coordinateSpace: 'screen', blendMode: 0, opacity: 1,
		fitMode: 'contain', position: [10, 0], origin: [0, 0], scale: [5, 5], rotation: 0, depth: 0 };
	try {
		const output = compositor.render(encoder, background, { kind: 'texture', texture: { width: 8, height: 4, createView: () => ({}) } }, settings, { parent: [1, 0, 0, 1, 0, 0], depth: 0 });
		assert.deepEqual(output.region, region);
		assert.deepEqual([output.texture.width, output.texture.height], [20, 6]);
	} finally { compositor.dispose(); }
});

// 【素材寸法とfitに応じて支点だけを画面座標へ変換する】
// originを画面基準のまま渡すと、縦横比が違う素材の端を固定できない。
// 同じcompositorへの入力サイズ・fit・uniform切り替えでも毎回換算し、Positionは保持する。
test('maps source-relative origins through fit while keeping positions in output space', () => {
	const { device, calls, encoder } = gpuFixture();
	const compositor = createTimelineCompositor({ device, vertex: {}, resolution: { width: 100, height: 100 } });
	const background = { kind: 'texture', texture: { width: 100, height: 100, createView: () => ({}) } };
	const wide = { kind: 'texture', texture: device.createTexture({ size: [400, 200], format: 'rgba16float' }) };
	const tall = { kind: 'texture', texture: device.createTexture({ size: [200, 400], format: 'rgba16float' }) };
	const settings = { blendMode: 0, opacity: 1, position: [0.25, -0.5], origin: [1, -1], scale: [1, 1], rotation: 0 };
	for (const [source, fit, expectedOrigin] of [
		[wide, 'contain', [1, -0.5]], [wide, 'cover', [2, -1]], [wide, 'stretch', [1, -1]],
		[tall, 'contain', [0.5, -1]], [tall, 'cover', [1, -2]], [background, 'contain', [1, -1]],
	]) {
		const writeIndex = calls.writes.length;
		compositor.render(encoder, background, source, { ...settings, fitMode: fit });
		const uniforms = calls.writes[writeIndex];
		// 逆行列へPositionを渡すと、fit前の素材支点に戻る。
		const mapped = [uniforms[0] * settings.position[0] * 2 + uniforms[1] * settings.position[1] * 2 + uniforms[2], uniforms[4] * settings.position[0] * 2 + uniforms[5] * settings.position[1] * 2 + uniforms[6]];
		const sourceSize = source.kind === 'texture' ? [source.texture.width, source.texture.height] : [100, 100];
		assert.deepEqual(mapped, settings.origin.map((value, axis) => value * 2 * Math.max(...sourceSize) / sourceSize[axis]));
		assert.equal(1 / uniforms[0], Math.abs(expectedOrigin[0]));
		assert.equal(1 / uniforms[5], Math.abs(expectedOrigin[1]));
	}
	compositor.dispose();
});

// 【支点だけの変更を無変形と誤認しない】
// アンカーポイント方式では等倍・無回転でもoriginを変えると配置が動く。
// positionが同じ点を指す場合は変換が相殺されるので、借用出力の最適化を維持する。
test('only bypasses anchor placement when position cancels the fitted origin', () => {
	const { device, calls, encoder } = gpuFixture();
	const compositor = createTimelineCompositor({ device, vertex: {}, resolution: { width: 8, height: 4 } });
	const background = { kind: 'texture', texture: { width: 8, height: 4, createView: () => ({}) } };
	const textureSource = { kind: 'texture', texture: device.createTexture({ size: [4, 2], format: 'rgba16float' }) };
	const settings = { blendMode: 19, opacity: 1, fitMode: 'contain', position: [0, 0], origin: [1, -1], scale: [1, 1], rotation: 0 };
	for (const source of [textureSource, { kind: 'texture', texture: { width: 8, height: 4, createView: () => ({}) } }]) {
		assert.notEqual(compositor.render(encoder, background, source, settings), source);
		assert.deepEqual(compositor.render(encoder, background, source, { ...settings, position: [1, -1] }), {
			...source, region: { bounds: { left: -1, bottom: -1, right: 1, top: 1 }, frameSize: { width: 8, height: 4 } },
		});
	}
	assert.equal(calls.draws, 2);
	compositor.dispose();
});

// 【描画時の主出力選択】
// Custom Node Graph Effectの主出力IDを変更すると描画対象が切り替わり、nullなら主出力を返さない。
// 出力配列の先頭や以前の主出力を暗黙に使い続ける不具合を防ぐ。
test('renders the selected Custom Node Graph Effect primary output after updates', async t => {
	const { device, encoder } = gpuFixture();
	const inputs = { a: { kind: 'uniform', value: [1, 0, 0, 1] }, b: { kind: 'uniform', value: [0, 1, 0, 1] } };
	for (const primaryOutput of ['b', 'a', null]) {
		const graph = { ...publicGraph, primaryOutput };
		const renderer = await place(device, inline(graph), { inputs, usedOutputPorts: new Set(primaryOutput == null ? [] : [primaryOutput]) });
		t.after(() => renderer.dispose());
		renderer.render(shaderFrame(), encoder);
		assert.deepEqual([...renderer.outputs.keys()], primaryOutput == null ? [] : [primaryOutput]);
		if (primaryOutput != null) assert.equal(renderer.outputs.get(primaryOutput), inputs[primaryOutput]);
	}
});

// 【不透明度0と無変形の置き換えで余分なテクスチャを作らない】
// 置き換え後の座標情報は更新するが、借用した画素の所有権は取得せず破棄もしない。
test('passes through timeline outputs without taking ownership', () => {
	const { device, calls, encoder } = gpuFixture();
	const compositor = createTimelineCompositor({ device, vertex: {}, resolution: { width: 8, height: 4 } });
	const background = { kind: 'uniform', value: [0, 0, 0, 0] };
	const source = { kind: 'texture', texture: device.createTexture({ size: [4, 2], format: 'rgba16float' }) };
	const settings = { blendMode: 19, opacity: 1, fitMode: 'contain', position: [0, 0], origin: [0, 0], scale: [1, 1], rotation: 0 };
	assert.equal(compositor.render(encoder, background, source, settings).texture, source.texture);
	assert.equal(compositor.render(encoder, background, source, { ...settings, opacity: 0 }), background);
	assert.equal(compositor.render(encoder, background, source, { ...settings, blendMode: 10 }), background);
	assert.equal(calls.textures.length, 1);
	assert.equal(calls.draws, 0);
	compositor.dispose();
	assert.equal(source.texture.destroyed, false);
	assert.ok(calls.buffers.every(buffer => buffer.destroyed));
});

// 【レイヤーごとの出力所有権】
// 各レイヤーが別々の出力を所有し、値の変更時には再利用、破棄時には所有物だけを解放する。
test('owns separate timeline targets and reuses pipelines across parameter changes', () => {
	const { device, calls, encoder } = gpuFixture();
	const options = { device, vertex: {}, resolution: { width: 8, height: 4 } };
	const first = createTimelineCompositor(options);
	const second = createTimelineCompositor(options);
	const background = { kind: 'texture', texture: { width: 8, height: 4, createView: () => ({}) } };
	const source = { kind: 'texture', texture: { width: 8, height: 4, createView: () => ({}) } };
	const settings = { blendMode: 0, opacity: 0.5, fitMode: 'contain', position: [0, 0], origin: [0, 0], scale: [1, 1], rotation: 0 };
	const a = first.render(encoder, background, source, settings);
	const shaderCount = calls.shaders.length;
	const updated = first.render(encoder, background, source, { ...settings, rotation: 0.5, blendMode: 3 });
	assert.equal(updated.texture, a.texture);
	assert.equal(calls.shaders.length, shaderCount);
	const b = second.render(encoder, a, source, settings);
	assert.notEqual(a.texture, b.texture);
	assert.equal(a.texture.format, 'rgba16float');
	assert.equal(calls.textures.length, 2);
	first.dispose();
	assert.equal(a.texture.destroyed, true);
	assert.equal(b.texture.destroyed, false);
	second.dispose();
	assert.ok(calls.textures.every(texture => texture.destroyed));
	assert.ok(calls.buffers.every(buffer => buffer.destroyed));
});

// 【描画済みの寸法だけを公開し、サイズ変更時に状態とインスタンスを更新する】
// 仮確保や未使用出力をUIへ出さず、破棄したインスタンスの遅延通知も無視する。
test('exposes planned output dimensions independently of preparation status', async t => {
	const { device, encoder } = gpuFixture(), wait = Promise.withResolvers();
	const renderer = await place(device, native('probe'), { resolution: { width: 50, height: 20 } }, {
		probe: [definition, { init: () => ({ prepare: () => wait.promise, render() {}, dispose() {} }) }],
	});
	t.after(() => renderer.dispose());
	const output = renderer.outputs.get('output'), frame = shaderFrame();
	assert.deepEqual(output.resolution, { width: 50, height: 20 });
	assert.equal(renderer.tryPrepare(frame), false);
	assert.equal(renderer.preparationStatus.type, 'loading');
	wait.resolve(); await renderer.prepare(frame); renderer.render(frame, encoder);
	assert.equal(renderer.outputs.get('output'), output);
});

// 【Timelineの下層textureをGraphの公開入力へ渡す】
// 下層で既に乗算した色を再変換せず、Scene寸法の同じtextureを借用する。
test('borrows the scene texture through a public graph input', async t => {
	let received;
	const layer = createTimelineEffectProbe({ primaryInputParameter: 'image',
		paramDefs: { image: { canNode: true, dataType: { kind: 'color' }, defaultValue: literal([0, 0, 0, 0]) } },
		render(frame, inputs) { received = inputs.image; } });
	t.after(() => layer.destroy());
	const image = layer.texture();
	await layer.evaluate({ sceneTimeMs: 10, contentTimeMs: 10, contentEndTimeMs: 100, clipElapsedTimeMs: 10, clipDurationMs: 100,
		timeDelta: 0, isExport: false, getInput: async () => image }, new AbortController().signal);
	assert.equal(received.kind, 'texture');
	assert.equal(received.texture, image.texture);
});

// 【バイパス経由の定数入力】
// In→バイパス→エフェクトでも定数の精度と乗算済み色を保ち、GPUへの転送を発生させない。
test('passes Custom Node Graph Effect constants through bypasses without allocating input textures', async t => {
	const { device, calls, encoder } = gpuFixture();
	const graph = { ...publicGraph, nodes: [{ id: 'bypass', effectSource: native('colorMix'), isBypass: true,
		params: { inputA: { inputSource: 'customNodeGraphEffectPublicParameterReference', parameterId: 'a' } } }], outputSources: { a: { nodeId: 'bypass', outputPort: 'output' } } };
	const input = { kind: 'uniform', value: [0.125, 0.25, 0.5, 0.5] };
	const renderer = await place(device, inline(graph), { inputs: { a: input }, usedOutputPorts: new Set(['a']) }); t.after(() => renderer.dispose());
	renderer.render(shaderFrame(), encoder);
	assert.deepEqual(renderer.outputs.get('a').value, input.value); assert.equal(calls.textures.length, 0);
});

// 【別配置の公開入力を切り替える】
// 同じInポートの定数/画像切替を検出し、各接続の設定を独立して適用する。
test('switches Custom Node Graph Effect outputs between constants and borrowed textures', async t => {
	const { device, encoder } = gpuFixture();
	const texture = device.createTexture({ size: [3, 2] });
	for (const input of [{ kind: 'uniform', value: [1, 0, 0, 1] }, { kind: 'texture', texture, resolution: texture }]) {
		const renderer = await place(device, inline(publicGraph), { inputs: { a: input }, usedOutputPorts: new Set(['a']) });
		renderer.render(shaderFrame(), encoder); assert.equal(renderer.outputs.get('a'), input); renderer.dispose(); assert.equal(texture.destroyed, false);
	}
});

for (const enable32bit of [false, true]) {
	// 【表示用の定数texture】
	// 定数のテクスチャ化は表示境界だけで行い、同値の転送を省略し、所有リソースだけ破棄する。
	test(`materializes constants only at the texture boundary with ${enable32bit ? 32 : 16}-bit storage`, () => {
		const { device, calls } = gpuFixture();
		const uploads = [];
		device.queue.writeTexture = (target, data, layout) => uploads.push({ target, data: [...data], layout });
		const resolver = new UniformOrTextureToTextureResolver(device, enable32bit);
		const constant = { kind: 'uniform', value: [0.25, 0.125, 0, 0.25] };
		const texture = resolver.resolve(constant);
		assert.equal(texture.format, enable32bit ? 'rgba32float' : 'rgba16float');
		assert.deepEqual(uploads[0].data, enable32bit ? constant.value : [0x3400, 0x3000, 0, 0x3400]);
		assert.equal(uploads[0].layout.bytesPerRow, enable32bit ? 16 : 8);
		assert.strictEqual(resolver.resolve({ ...constant, value: [...constant.value] }), texture);
		assert.equal(uploads.length, 1);
		assert.strictEqual(resolver.resolve({ kind: 'uniform', value: [0.5, 0, 0, 1] }), texture);
		assert.equal(uploads.length, 2);
		const scalar = resolver.resolve({ kind: 'uniform', value: [1] });
		const vector = resolver.resolve({ kind: 'uniform', value: [1, 2] });
		assert.equal(scalar.format, enable32bit ? 'r32float' : 'r16float');
		assert.equal(vector.format, enable32bit ? 'rg32float' : 'rg16float');
		assert.deepEqual(toShaderInput({ kind: 'uniform', value: [1] }, { fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' }).value, [1, 0, 0, 1]);
		const borrowed = device.createTexture({ size: [10, 20] });
		assert.strictEqual(resolver.resolve({ kind: 'texture', texture: borrowed }), borrowed);
		assert.equal(calls.textures.length, 4);
		resolver.dispose();
		assert.ok([texture, scalar, vector].every(texture => texture.destroyed));
		assert.equal(borrowed.destroyed, false);
	});
}

// 【ID付き配列から接続と定数を評価し、エフェクトへは通常の配列を渡す】
// 構造体配列内の接続・定数を解決し、要素の変更でレンダラーのキャッシュも更新する。
// 保存用のラッパーをGPU入力へ渡したり、接続設定の走査を落としたりしないことを確認する。
test('resolves nested array inputs and invalidates sampling changes', async t => {
	const { device, encoder } = gpuFixture(), texture = device.createTexture({ size: [4, 2] });
	const candidate = definition.paramDefs.inputA;
	const array = { dataType: { kind: 'array', elementType: candidate.dataType }, ui: { label: 'Items', control: { element: {} } },
		element: { canNode: true, defaultValue: candidate.defaultValue }, defaultValue: literal([]) };
	for (const filterMode of ['linear', 'nearest']) {
		const sampling = { fitMode: 'contain', wrapMode: 'transparent', filterMode };
		const graph = { ...publicGraph, nodes: [{ id: 'probe', effectSource: native('probe'), params: { items: literal([{ id: 'item',
			binding: { inputSource: 'customNodeGraphEffectPublicParameterReference', parameterId: 'a', sampling } }]) } }],
			outputSources: { a: { nodeId: 'probe', outputPort: 'output' } } };
		let captured;
		const renderer = await place(device, inline(graph), { inputs: { a: { kind: 'texture', texture, resolution: texture } }, usedOutputPorts: new Set(['a']) },
			{ probe: [{ ...definition, paramDefs: { items: array }, primaryInputParameter: null, resolutionInputParameters: [] },
				{ init: ({ inputs }) => ({ render() { captured = inputs.items.elements[0]; }, dispose() {} }) }] });
		renderer.render(shaderFrame(), encoder); renderer.dispose();
		assert.equal(captured.texture, texture); assert.deepEqual(captured.sampling, sampling);
	}
});

function place(device, effectSource, options = {}, implementations = {}) {
	const registry = { colorMix: [definition, effect], image: [imageDefinition, imageEffect], video: [videoDefinition, videoEffect], ...implementations };
	return createEffectInstance({ effectSource, definitions: { getNativeEffect: id => registry[id][0] }, resolution: { width: 32, height: 32 },
		usedOutputPorts: new Set(['output']), ...options }, { device, defaultVertexShaderModule: {}, enable32bitDataTextures: false }, id => registry[id][1]);
}
const native = id => ({ type: 'nativeEffect', id });
const inline = graph => ({ type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: graph });
const publicGraph = { paramDefs: { a: definition.paramDefs.inputA, b: definition.paramDefs.inputB }, resolutionInputParameters: [],
	primaryInputParameter: 'a', primaryOutput: 'a', nodes: [], outputDefs: { a: definition.outputDefs.output, b: definition.outputDefs.output },
	outputSources: { a: { parameterId: 'a' }, b: { parameterId: 'b' } } };
const shaderFrame = () => ({ time: 0, timeDelta: 0 });

// 【定数の色とサンプリング】
// 定数色は一度だけ乗算し、スカラーやベクトルの値は変更しない。
test('normalizes constants and preserves explicit connection sampling settings', () => {
	assert.deepEqual(constantShaderInput('color', [1, 0.5, 0, 0.25]).value, [0.25, 0.125, 0, 0.25]);
	assert.deepEqual(constantShaderInput('color', null).value, [0, 0, 0, 0]);
	assert.deepEqual(constantShaderInput('vector', [-2, 3]).value, [-2, 3]);
	assert.deepEqual(constantShaderInput('scalar', 0.123456789).value, [0.123456789]);
	assert.deepEqual(textureShaderInput('texture', { fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' }), { kind: 'texture', texture: 'texture', fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' });
});

// 【縦横比の異なる入力の座標変換】
// 横長・縦長と解像度だけの違いを含め、入力を出力へ収める逆写像を確認する。
test('maps each input aspect ratio independently of its pixel resolution', () => {
	const square = { width: 100, height: 100 };
	assert.deepEqual(inputUvScale({ width: 400, height: 200 }, square, 'cover'), [0.5, 1]);
	assert.deepEqual(inputUvScale({ width: 400, height: 200 }, square, 'contain'), [1, 2]);
	assert.deepEqual(inputUvScale({ width: 200, height: 400 }, square, 'cover'), [1, 0.5]);
	assert.deepEqual(inputUvScale({ width: 200, height: 400 }, square, 'contain'), [2, 1]);
	assert.deepEqual(inputUvScale({ width: 400, height: 200 }, square, 'stretch'), [1, 1]);
	assert.deepEqual(inputUvScale({ width: 800, height: 800 }, square, 'cover'), [1, 1]);
});

// 【Color Mixの固定入力とGPU資源】
// 各配置でuniform・textureを選び、その配置の複数フレームで同じパイプラインを使う。
test('reuses colorMix variants and releases all owned buffers', async t => {
	const { device, encoder, calls } = gpuFixture();
	const image = device.createTexture({ size: [8, 4] });
	for (const input of [constantShaderInput('color', [1, 0, 0, 1]), { kind: 'texture', texture: image, resolution: image }]) {
		const renderer = await place(device, native('colorMix'), { inputs: { inputA: input } });
		const shaders = calls.shaders.length;
		renderer.render(shaderFrame(), encoder); renderer.render(shaderFrame(), encoder);
		assert.equal(calls.shaders.length, shaders); renderer.dispose();
	}
	assert.equal(image.destroyed, false); assert.ok(calls.buffers.every(buffer => buffer.destroyed));
});

// 【Color Mixの定数入力】
// 実際のパラメータ評価・接続解決を通し、新方式では定数テクスチャを確保・更新しない。
test('resolves colorMix inputs through the renderer without constant textures', async t => {
	const { device, encoder, calls } = gpuFixture();
	const renderer = await place(device, native('colorMix'), { params: { inputA: literal([1, 0, 0, 0.25]), amount: literal(0.5) } }); t.after(() => renderer.dispose());
	renderer.render(shaderFrame(), encoder);
	assert.equal(calls.textures.length, 1); assert.equal(calls.uploads, 0); assert.equal(calls.draws, 1);
});

// 【外部textureの更新と切断】
// 同じ外部パラメータが定数→テクスチャ→定数へ戻るとき、古い描画キャッシュを使わない。
test('refreshes external textures and restores constants after disconnecting them', async t => {
	const { device, encoder, calls } = gpuFixture();
	const first = device.createTexture({ size: [3, 2] }), next = device.createTexture({ size: [3, 2] });
	let image = first;
	const renderer = await place(device, native('colorMix'), { inputs: { inputA: { kind: 'texture', resolution: first, get texture() { return image; } } } });
	renderer.render(shaderFrame(), encoder); const groups = calls.groups.length, shaders = calls.shaders.length;
	image = next; renderer.render(shaderFrame(), encoder);
	assert.equal(calls.shaders.length, shaders); assert.ok(calls.groups.length > groups); renderer.dispose();
	const constant = await place(device, native('colorMix')); constant.render(shaderFrame(), encoder); constant.dispose();
	assert.equal(first.destroyed, false); assert.equal(next.destroyed, false);
});

// 【画像の原寸・差し替えと解像度モードを独立して扱う】
// fit変更は出力サイズを変えず、素材サイズ・明示モードの変更だけで再確保する。
test('resizes automatic image outputs to the selected asset and preserves borrowed textures', async t => {
	const { device, encoder } = gpuFixture();
	const images = [[8, 4], [4, 9]].map(size => device.createTexture({ size }));
	for (const texture of [...images, null]) {
		const renderer = await place(device, native('image'), { resolutionSetting: { mode: 'auto', scale: 1 },
			staticSettings: { image: texture == null ? null : 'asset' }, resources: { assets: texture == null ? [] : [
				{ id: 'asset', name: 'photo', fileDataType: 'image/png', fileData: new Blob(), width: texture.width, height: texture.height }],
				assetTextures: new Map([['asset', texture]]) } });
		renderer.render(shaderFrame(), encoder); const output = renderer.outputs.get('output');
		assert.deepEqual(output.resolution, { width: texture?.width ?? 32, height: texture?.height ?? 32 }); renderer.dispose(); assert.equal(output.texture.destroyed, true);
	}
	assert.ok(images.every(image => !image.destroyed));
});
