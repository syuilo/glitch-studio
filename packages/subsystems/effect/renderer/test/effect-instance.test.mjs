import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEffectInstance } from '../src/create-effect-instance.ts';
import { validateEffectSource } from '@gs/subsystems_effect_shared/validate-effect-source.ts';

const size = { width: 24, height: 12 };
const scalar = { dataType: { kind: 'scalar' }, ui: { label: 'Value', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: 0 } };
const base = { kind: 'generate', primaryInputParameter: null, primaryOutput: 'main', resolutionInputParameters: [],
	paramDefs: {}, outputDefs: { main: { dataType: { kind: 'scalar' } } } };
const sampling = { fitMode: 'contain', wrapMode: 'clamp', filterMode: 'nearest' };
const wire = (nodeId, outputPort) => ({ inputSource: 'node', source: { nodeId, outputPort }, sampling });
const native = id => ({ type: 'nativeEffect', id });
const inline = customNodeGraphEffect => ({ type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect });

// 【入れ子の複数出力から到達する配置を一度だけ、上流から描画する】
// 同じ登録の別配置には別の履歴が必要だが、同じ配置の出力をいくつ読んでも履歴は一度だけ進める。
// 共有と独立性の両方を複数フレームで検査し、未使用のポート・ノードが確保されないことも確かめる。
test('plans nested ports once and keeps state per placement', async () => {
	const dual = { ...base, paramDefs: { value: scalar }, outputDefs: { a: {}, b: {}, unused: {} } };
	const sum = { ...base, paramDefs: { a: scalar, b: scalar }, resolutionInputParameters: ['a', 'b'] };
	const child = { ...dual, nodes: [{ id: 'source', effectSource: native('dual'), resolution: size,
		params: { value: { inputSource: 'expression', expression: 'TIME' } } }], outputSources: {
		a: { nodeId: 'source', outputPort: 'a' }, b: { nodeId: 'source', outputPort: 'b' },
	} };
	const childSource = { type: 'customNodeGraphEffectReference', id: 'child' };
	const graph = { ...base, nodes: [
		{ id: 'sum', effectSource: native('sum'), params: { a: wire('left', 'a'), b: wire('left', 'b') } },
		{ id: 'left', effectSource: childSource, params: {} },
		{ id: 'right', effectSource: childSource, params: {} },
		{ id: 'unused', effectSource: native('missing'), params: {} },
	], outputSources: { main: { nodeId: 'sum', outputPort: 'main' }, other: { nodeId: 'right', outputPort: 'b' } } };
	const initialized = [];
	const rendered = [];
	const destroyed = [];
	const resolutions = [];
	const paths = [];
	const definitions = { getNativeEffect(id) { resolutions.push(id); return { dual, sum }[id]; }, getCustomNodeGraphEffect: () => child };
	const instance = await createEffectInstance({
		effectSource: inline(graph), definitions, resolution: { width: 10, height: 10 }, usedOutputPorts: new Set(['main', 'other']),
		bindParameterValue(binding, _def, path) { paths.push(path); return frame => frame.time; },
	}, {}, id => ({
		createOutputTexture(port) { return { port, destroy() { destroyed.push(port); } }; },
		init({ inputs, outputTextures, resolution }) {
			assert.deepEqual(resolution, size);
			const index = initialized.length;
			initialized.push([id, [...outputTextures.keys()]]);
			return { render(frame) {
				if (id === 'dual') assert.equal(inputs.value.value[0], frame.time);
				else assert.deepEqual([inputs.a.texture.port, inputs.b.texture.port], ['a', 'b']);
				rendered.push(index);
			}, dispose() {} };
		},
	}));
	assert.deepEqual(initialized, [['dual', ['a', 'b']], ['sum', ['main']], ['dual', ['b']]]);
	assert.deepEqual(paths, [['left', 'source'], ['right', 'source']]);
	const lookups = resolutions.slice();
	assert.deepEqual(instance.outputs.get('main').resolution, size);
	assert.equal(instance.render({ time: 1 }), undefined);
	assert.equal(instance.render({ time: 2 }), undefined);
	assert.deepEqual(rendered, [0, 1, 2, 0, 1, 2]);
	assert.deepEqual(resolutions, lookups);
	instance.dispose();
	instance.dispose();
	assert.deepEqual(destroyed, ['b', 'main', 'b', 'a']);
});

// 【子グラフへの直結は借用textureだけを公開する】
// GPUを確保せず元の寸法・参照・世代を読める。別の配置で同じ入力にuniformを渡した場合は出力も値の評価も不要。
test('forwards changing borrowed textures through nested graphs and omits uniform outputs', async t => {
	const child = { ...base, paramDefs: { source: scalar }, nodes: [], outputSources: { main: { parameterId: 'source' } } };
	const graph = { ...child, nodes: [{ id: 'child', effectSource: inline(child),
		params: { source: { inputSource: 'customNodeGraphEffectPublicParameterReference', parameterId: 'source' } } }],
		outputSources: { main: { nodeId: 'child', outputPort: 'main' } } };
	const place = source => createEffectInstance({
		effectSource: inline(graph), inputs: { source }, usedOutputPorts: new Set(['main']), definitions: {}, resolution: size,
	}, {}, assert.fail);
	const uniform = await place({ kind: 'uniform', get value() { assert.fail('Unused output read a uniform'); } });
	t.after(() => uniform.dispose());
	uniform.render({ time: 0 });
	assert.equal(uniform.outputs.has('main'), false);

	let texture = {};
	let version = 0;
	const input = { kind: 'texture', resolution: size, get texture() { return texture; }, get version() { return version; } };
	const instance = await place(input);
	t.after(() => instance.dispose());
	const output = instance.outputs.get('main');
	assert.equal(output, input);
	texture = {};
	version++;
	instance.render({ time: 0 });
	assert.equal(output.texture, texture);
	assert.equal(output.version, version);
});

// 【出力がない子グラフにつないだ入力は、受け取り側の既定値を使う】
// 子のInに値を渡した配置では、その値が子のOutを越えて親側の描画に混入しない。
test('uses the downstream default when a nested graph has no texture output', async t => {
	const child = { ...base, paramDefs: { source: scalar }, nodes: [], outputSources: { main: { parameterId: 'source' } } };
	const consumer = { ...base, paramDefs: { input: { ...scalar, defaultValue: { inputSource: 'literal', value: 4 } } } };
	const graph = { ...base, nodes: [
		{ id: 'child', effectSource: inline(child), params: { source: { inputSource: 'literal', value: 7 } } },
		{ id: 'consumer', effectSource: native('consumer'), params: { input: wire('child', 'main') } },
	], outputSources: { main: { nodeId: 'consumer', outputPort: 'main' } } };
	const instance = await createEffectInstance({
		effectSource: inline(graph), definitions: { getNativeEffect: () => consumer }, usedOutputPorts: new Set(['main']), resolution: size,
	}, {}, () => ({
		createOutputTexture: () => ({ destroy() {} }),
		init({ inputs }) {
			assert.deepEqual(inputs.input, { kind: 'uniform', value: [4] });
			return { render() {}, dispose() {} };
		},
	}));
	t.after(() => instance.dispose());
	assert.equal(instance.outputs.has('main'), true);
});

// 【GPU確保前の入力種別検査と部分初期化の巻き戻し】
// 下流の入力構成が成立しない場合は上流の確保も不要。GPU初期化自体が失敗した場合は確保済みの分を解放する。
test('fixes shader input kinds before allocation and releases partial initialization', async () => {
	const shader = { ...base, paramDefs: { a: scalar, b: scalar }, code: '', shaderApiVersion: 1 };
	const root = { ...base, nodes: [{ id: 'upstream', effectSource: native('n'), params: {} },
		{ id: 'shader', effectSource: { type: 'customShaderEffectReference', id: 's' }, params: { a: wire('upstream', 'main'), b: { inputSource: 'customNodeGraphEffectPublicParameterReference', parameterId: 'invalid' } } }],
		paramDefs: { invalid: scalar }, outputSources: { main: { nodeId: 'shader', outputPort: 'main' } } };
	const placement = { effectSource: inline(root), definitions: { getCustomShaderEffect: () => shader, getNativeEffect: () => base },
		inputs: { invalid: { kind: 'array', elements: [] } }, resolution: size, usedOutputPorts: new Set(['main']) };
	await assert.rejects(createEffectInstance(placement, {}, assert.fail), /fixed uniform or texture/);
	const destroyed = [];
	await assert.rejects(createEffectInstance({ ...placement, effectSource: native('n') }, {}, () => ({
		createOutputTexture(id) { return { destroy() { destroyed.push(id); } }; }, init() { throw new Error('init failed'); },
	})), /init failed/);
	assert.deepEqual(destroyed, ['main']);
});

// 【描画に使われない定義も編集時に循環と非literalの既定値を検査する】
// 到達ポートだけを描くレンダラーに、保存形式の正しさを保証する責任を持ち込まない。
test('validates recursive references and defaults at the editing boundary', () => {
	const source = { type: 'customNodeGraphEffectReference', id: 'g' };
	const graph = { ...base, nodes: [{ id: 'self', effectSource: source, params: {} }], outputSources: {} };
	assert.throws(() => validateEffectSource(source, { getCustomNodeGraphEffect: () => graph }), /Cyclic Custom Node Graph Effect/);
	const array = { dataType: { kind: 'array', elementType: scalar.dataType }, ui: { label: '', control: { element: {} } }, element: scalar,
		defaultValue: { inputSource: 'literal', value: [{ id: 'e', binding: { inputSource: 'expression', expression: 'TIME' } }] } };
	assert.throws(() => validateEffectSource(inline({ ...graph, nodes: [], paramDefs: { array } }), {}), /must be literal/);
});

// 【解像度だけに寄与する配線は、配列・構造体の中にあっても描画しない】
// 子の基準寸法は入力由来でも、子の公開出力への経路で画素を読まなければ上流のGPU資源は不要。
test('resolves nested input dimensions without rendering a size-only dependency', async () => {
	const field = { dataType: { kind: 'struct', fields: { gain: scalar.dataType } }, ui: { label: '', control: { fields: { gain: scalar.ui } } },
		fields: { gain: scalar }, defaultValue: { inputSource: 'literal', value: { gain: scalar.defaultValue } } };
	const array = { dataType: { kind: 'array', elementType: field.dataType }, element: field, ui: { label: '', control: { element: field.ui.control } }, defaultValue: { inputSource: 'literal', value: [] } };
	const child = { ...base, paramDefs: { sizes: array }, resolutionInputParameters: ['sizes'],
		nodes: [{ id: 'draw', effectSource: native('draw'), params: {} }], outputSources: { main: { nodeId: 'draw', outputPort: 'main' } } };
	const graph = { ...base, nodes: [{ id: 'metadata', effectSource: native('metadata'), resolution: size, params: {} },
		{ id: 'child', effectSource: inline(child), params: { sizes: { inputSource: 'literal',
			value: [{ id: 'e', binding: { inputSource: 'literal', value: { gain: wire('metadata', 'main') } } }] } } }],
		outputSources: { main: { nodeId: 'child', outputPort: 'main' } } };
	const allocated = [];
	const instance = await createEffectInstance({ effectSource: inline(graph), definitions: { getNativeEffect: () => base }, resolution: { width: 1, height: 1 },
		usedOutputPorts: new Set(['main']) }, {}, id => ({
		createOutputTexture(port, resolution) { allocated.push([id, port, resolution]); return { destroy() {} }; },
		init() { return { render() {}, dispose() {} }; },
	}));
	assert.deepEqual(allocated, [['draw', 'main', size]]);
	instance.dispose();
});

// 【出力を追加したときだけ、その出力が使う配線と式を描画順に含める】
// Maskだけでも画像の寸法は必要になる。色も要求された場合は、後から見つけた上流と式の評価を描画の前に置く。
test('collects input dependencies across requested native outputs before scheduling', async () => {
	const shade = { ...base, paramDefs: { image: scalar, gain: scalar }, resolutionInputParameters: ['image'],
		outputDefs: { mask: { inputParameters: [] }, color: {} } };
	const graph = { ...base, nodes: [
		{ id: 'source', effectSource: native('source'), resolution: size, params: {} },
		{ id: 'shade', effectSource: native('shade'), params: { image: wire('source', 'main'), gain: { inputSource: 'expression', expression: 'TIME' } } },
	], outputSources: { mask: { nodeId: 'shade', outputPort: 'mask' }, color: { nodeId: 'shade', outputPort: 'color' } } };
	for (const ports of [['mask'], ['mask', 'color']]) {
		const events = [];
		const instance = await createEffectInstance({
			effectSource: inline(graph), definitions: { getNativeEffect: id => id === 'shade' ? shade : base },
			usedOutputPorts: new Set(ports), resolution: { width: 1, height: 1 },
			bindParameterValue() {
				events.push('bind gain');
				return frame => { events.push('evaluate gain'); return frame.time; };
			},
		}, {}, id => ({
			createOutputTexture(port, resolution) {
				assert.deepEqual(resolution, size);
				events.push('allocate ' + port);
				return { destroy() {} };
			},
			init() { return { render() { events.push('draw ' + id); }, dispose() {} }; },
		}));
		instance.render({ time: 1 });
		instance.dispose();
		assert.deepEqual(events, ports.length === 1 ? ['allocate mask', 'draw shade'] :
			['bind gain', 'allocate main', 'allocate mask', 'allocate color', 'evaluate gain', 'draw source', 'draw shade']);
	}
});
