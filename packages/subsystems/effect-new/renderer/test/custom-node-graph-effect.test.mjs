import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// 公開入口はCustom Shader EffectのWGSLも読み込む。描画回数と資源寿命の検証にはGPUを使わない。
const bundle = await build({
	entryPoints: [fileURLToPath(new URL('../src/create-effect-instance.ts', import.meta.url))],
	bundle: true, platform: 'browser', format: 'esm', write: false, loader: { '.wgsl': 'text' },
});
const { createEffectInstance } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].contents).toString('base64'));

const scalarOutput = { dataType: { kind: 'scalar' } };
const scalarParameter = {
	...scalarOutput, canNode: true, defaultValue: { inputSource: 'literal', value: 0 },
	ui: { label: 'Input', control: { controlType: 'number' } },
};
const historyDefinition = {
	kind: 'generate', paramDefs: {}, outputDefs: { current: scalarOutput, previous: scalarOutput },
	primaryInputId: null, primaryOutputId: 'current',
};
const nodePort = (nodeId, outputPort) => ({ inputSource: 'node', nodeId, outputPort });
const publicParameter = parameterId => ({ inputSource: 'publicParameter', parameterId });
const historyNode = { id: 'history', effectSource: { type: 'nativeEffect', id: 'history' }, params: {} };
const historyGraph = {
	...historyDefinition, nodes: [historyNode],
	outputs: { current: nodePort('history', 'current'), previous: nodePort('history', 'previous') },
};
const uniform = value => ({ kind: 'uniform', value: [value] });
const request = (ids, params = {}) => ({ time: 0, timeDelta: 0, requestedOutputIds: new Set(ids), params });

function renderReadyFrame(instance, frame) {
	assert.equal(instance.prepare(frame), undefined);
	assert.equal(instance.checkReady(), true);
	const outputs = instance.render({});
	assert.equal(instance.checkReady(), false);
	return outputs;
}

function createHistoryFixture(definition, pendingForRequest = () => null) {
	const placements = [];
	const instance = createEffectInstance({ type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: definition }, {
		catalog: {
			nativeEffects: new Map([['history', historyDefinition]]), customShaderEffects: new Map(),
			customNodeGraphEffects: new Map([['historyGraph', historyGraph]]),
		},
		device: {}, resolution: { width: 23, height: 7 }, enable32bitDataTextures: false,
		nativeEffectImplementations: new Map([['history', () => {
			const events = { frames: 0, disposals: 0 };
			placements.push(events);
			return {
				getOutputResolution: () => null,
				prepare(frame) {
					// 描画前に次の出力値は分かる。フレームを飛ばした場合も描画履歴はrenderだけが更新する。
					const outputs = new Map([...frame.requestedOutputIds].map(id => [id, uniform(id === 'current' ? events.frames + 1 : events.frames)]));
					return { outputs, pending: pendingForRequest(frame) };
				},
				render() {
					events.frames++;
				},
				dispose() { events.disposals++; },
			};
		}]]),
	});
	return { instance, placements };
}

function createNativeFixture(implementation) {
	return createEffectInstance(historyNode.effectSource, {
		catalog: { nativeEffects: new Map([['history', historyDefinition]]), customShaderEffects: new Map(), customNodeGraphEffects: new Map() },
		device: {}, resolution: { width: 1, height: 1 }, enable32bitDataTextures: false,
		nativeEffectImplementations: new Map([['history', () => ({ getOutputResolution: () => null, ...implementation })]]),
	});
}

// 【準備していない状態と準備中は同期描画を拒否し、描画したフレームは一度だけ消費する】
// プレビューはGPUの準備を待たずに戻ることがあり、ここで誤って履歴を更新したり配置を破棄すると
// 次の描画に影響する。準備後は渡したencoderへ同期的に記録し、同じ準備の再描画を拒否する。
test('records a ready frame synchronously and consumes it exactly once', async () => {
	const compilation = Promise.withResolvers();
	const output = uniform(3);
	const recordings = [];
	let disposals = 0;
	const instance = createNativeFixture({
		prepare: () => ({ outputs: new Map([['current', output]]), pending: compilation.promise }),
		render(encoder) { recordings.push(encoder); },
		dispose() { disposals++; },
	});
	const encoder = {};
	assert.equal(instance.checkReady(), false);
	assert.throws(() => instance.render(encoder));
	assert.equal(instance.prepare(request(['current'])), undefined);
	assert.equal(instance.checkReady(), false);
	assert.throws(() => instance.render(encoder));
	assert.deepEqual(recordings, []);
	assert.equal(disposals, 0);
	const ready = instance.waitUntilReady();
	compilation.resolve();
	assert.equal(await ready, true);
	assert.equal(instance.checkReady(), true);
	assert.equal(instance.render(encoder).get('current'), output);
	assert.equal(instance.checkReady(), false);
	assert.throws(() => instance.render(encoder));
	assert.deepEqual(recordings, [encoder]);
	instance.dispose();
	assert.equal(disposals, 1);
});

// 【準備失敗の診断を保持し、新しい準備で回復する】
// 同期で見つかったエラーも後から失敗したコンパイルも、確認・待機・描画に同一の診断を返す。
// まだGPUコマンドを記録していない配置なので、修正後のパラメータで再準備できる。
test('retains original preparation errors for polling and waiting and permits a retry', async () => {
	const synchronousError = new Error('Invalid input variant');
	const compilationError = new Error('Shader compilation failed');
	const compilation = Promise.withResolvers();
	let preparations = 0;
	let recordings = 0;
	let disposals = 0;
	const instance = createNativeFixture({
		prepare() {
			preparations++;
			if (preparations === 1) throw synchronousError;
			return { outputs: new Map([['current', uniform(1)]]), pending: preparations === 2 ? compilation.promise : null };
		},
		render() { recordings++; },
		dispose() { disposals++; },
	});
	const frame = request(['current']);
	instance.prepare(frame);
	assert.throws(() => instance.checkReady(), error => error === synchronousError);
	await assert.rejects(instance.waitUntilReady(), error => error === synchronousError);
	assert.throws(() => instance.render({}), error => error === synchronousError);
	instance.prepare(frame);
	const waiting = instance.waitUntilReady();
	compilation.reject(compilationError);
	await assert.rejects(waiting, error => error === compilationError);
	assert.throws(() => instance.checkReady(), error => error === compilationError);
	assert.throws(() => instance.render({}), error => error === compilationError);
	assert.equal(disposals, 0);
	assert.equal(recordings, 0);
	assert.deepEqual(renderReadyFrame(instance, frame).get('current'), uniform(1));
	assert.equal(recordings, 1);
	instance.dispose();
});

// 【同期描画が途中で失敗した場合は配置を破棄する】
// 履歴更新後の失敗は再準備で復元できない。元の例外をその場で返し、呼び出し側が後から
// disposeしても資源を二重破棄しない。
test('disposes an instance after a synchronous partial render failure', () => {
	const recordingError = new Error('Native Effect failed while recording');
	let frames = 0;
	let disposals = 0;
	const instance = createNativeFixture({
		prepare: () => ({ outputs: new Map([['current', uniform(frames + 1)]]) }),
		render() { frames++; throw recordingError; },
		dispose() { disposals++; },
	});
	instance.prepare(request(['current']));
	assert.equal(instance.checkReady(), true);
	assert.throws(() => instance.render({}), error => error === recordingError);
	assert.equal(instance.checkReady(), false);
	assert.throws(() => instance.render({}));
	assert.equal(frames, 1);
	assert.equal(disposals, 1);
	instance.dispose();
	assert.equal(disposals, 1);
});

// 【待機の中断・新しい準備・破棄を個別に扱う】
// 書き出しの中断で他の待機者まで取り消したり、旧フレームの遅い失敗や破棄後の完了が
// 次の描画状態を変更したりすると、プレビューと書き出しの間で状態が混ざる。
test('isolates aborted waiters and ignores superseded or disposed preparations', async () => {
	const first = Promise.withResolvers();
	const second = Promise.withResolvers();
	const third = Promise.withResolvers();
	const gates = [first, second, third];
	let preparations = 0;
	const instance = createNativeFixture({
		prepare() {
			const gate = gates[preparations++];
			return { outputs: new Map([['current', uniform(preparations)]]), pending: gate.promise };
		},
		render() {},
		dispose() {},
	});
	const frame = request(['current']);
	instance.prepare(frame);
	const supersededWaiter = instance.waitUntilReady();
	instance.prepare(frame);
	assert.equal(await supersededWaiter, false);
	const controller = new AbortController();
	const abortedWaiter = instance.waitUntilReady(controller.signal);
	const currentWaiter = instance.waitUntilReady();
	controller.abort();
	assert.equal(await abortedWaiter, false);
	first.reject(new Error('Obsolete compilation failed'));
	second.resolve();
	assert.equal(await currentWaiter, true);
	assert.deepEqual(instance.render({}).get('current'), uniform(2));
	instance.prepare(frame);
	const disposedWaiter = instance.waitUntilReady();
	instance.dispose();
	assert.equal(await disposedWaiter, false);
	third.resolve();
	await third.promise;
	assert.equal(instance.checkReady(), false);
	assert.throws(() => instance.render({}));
});

// 【入れ子の準備を飛ばしても準備済みの兄弟・子の履歴を進めない】
// 兄弟の主出力が先に使える場合でも、そのフレームが表示されるまで一切記録しない。
// 次の時刻で初めて両方の初回結果を受け取り、遅れて終わった旧準備を無視する。
test('skips a nested pending frame without recording siblings or advancing history', async () => {
	const pendingFrame = Promise.withResolvers();
	const nested = { type: 'customNodeGraphEffectReference', id: 'historyGraph' };
	const { instance, placements } = createHistoryFixture({
		...historyDefinition,
		nodes: [historyNode, { id: 'nested', effectSource: nested, params: {} }],
		outputs: { current: nodePort('history', 'current'), previous: nodePort('nested', 'previous') },
	}, frame => frame.time === 0 && frame.requestedOutputIds.has('previous') ? pendingFrame.promise : null);
	const frame = request(['current', 'previous']);
	instance.prepare(frame);
	const skipped = instance.waitUntilReady();
	assert.equal(instance.checkReady(), false);
	assert.throws(() => instance.render({}));
	assert.deepEqual(placements.map(item => item.frames), [0, 0]);
	const next = renderReadyFrame(instance, { ...frame, time: 1 });
	assert.equal(await skipped, false);
	assert.deepEqual(next.get('current'), uniform(1));
	assert.deepEqual(next.get('previous'), uniform(0));
	pendingFrame.resolve();
	await pendingFrame.promise;
	assert.deepEqual(placements.map(item => item.frames), [1, 1]);
	instance.dispose();
});

// 【未準備の上流からも借用テクスチャを下流の準備に渡す】
// 出力先が確保されていれば、上流のコンパイル中に下流も同じテクスチャで準備できる。
// 実際に画素を書き込む順序は、準備完了後に同じencoderへ上流・下流の順で記録することで保証する。
test('prepares consumers of pending textures before synchronously recording in dependency order', async () => {
	const compilation = Promise.withResolvers();
	const texture = {};
	const borrowed = { kind: 'texture', texture };
	const consumer = {
		...historyDefinition, kind: 'modify', paramDefs: { input: scalarParameter }, primaryInputId: 'input',
	};
	const graph = {
		...historyDefinition,
		nodes: [
			{ id: 'consumer', effectSource: { type: 'nativeEffect', id: 'consumer' }, params: { input: nodePort('producer', 'current') } },
			{ ...historyNode, id: 'producer' },
		],
		outputs: { current: nodePort('consumer', 'current') },
	};
	const calls = [];
	const instance = createEffectInstance({ type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: graph }, {
		catalog: { nativeEffects: new Map([['history', historyDefinition], ['consumer', consumer]]), customShaderEffects: new Map(), customNodeGraphEffects: new Map() },
		device: {}, resolution: { width: 12, height: 8 }, enable32bitDataTextures: false,
		nativeEffectImplementations: new Map([
			['history', () => ({
				getOutputResolution: () => ({ width: 12, height: 8 }),
				prepare() { calls.push('prepare producer'); return { outputs: new Map([['current', borrowed]]), pending: compilation.promise }; },
				render(encoder) { calls.push(['record producer', encoder]); },
				dispose() {},
			})],
			['consumer', () => ({
				getOutputResolution: () => null,
				prepare({ params }) {
					calls.push(['prepare consumer', params.input.texture]);
					return { outputs: new Map([['current', uniform(9)]]) };
				},
				render(encoder) { calls.push(['record consumer', encoder]); },
				dispose() {},
			})],
		]),
	});
	instance.prepare(request(['current']));
	assert.deepEqual(calls.splice(0), ['prepare producer', ['prepare consumer', texture]]);
	assert.equal(instance.checkReady(), false);
	compilation.resolve();
	assert.equal(await instance.waitUntilReady(), true);
	assert.deepEqual(calls, []);
	const encoder = {};
	assert.deepEqual(instance.render(encoder).get('current'), uniform(9));
	assert.deepEqual(calls, [['record producer', encoder], ['record consumer', encoder]]);
	instance.dispose();
});

// 【同じ子の複数出力をまとめて評価し、同じ登録定義でも配置ごとに履歴を持つ】
// 主出力・副出力の要求順や同じ出力の別名によって、子の描画回数が変わると履歴がずれる。
// 別の配置は後のフレームから使い始めても、その配置での初回の結果を返す。
test('evaluates all demanded ports once and isolates history by placement', () => {
	const effectSource = { type: 'customNodeGraphEffectReference', id: 'historyGraph' };
	const { instance, placements } = createHistoryFixture({
		...historyGraph,
		nodes: [{ id: 'left', effectSource, params: {} }, { id: 'right', effectSource, params: {} }],
		outputDefs: { current: scalarOutput, previous: scalarOutput, alias: scalarOutput, right: scalarOutput },
		outputs: { current: nodePort('left', 'current'), previous: nodePort('left', 'previous'), alias: nodePort('left', 'current'), right: nodePort('right', 'current') },
	});
	const first = renderReadyFrame(instance, request(['previous', 'alias', 'current']));
	assert.deepEqual(first.get('previous'), uniform(0));
	assert.deepEqual(first.get('current'), uniform(1));
	assert.equal(first.get('alias'), first.get('current'));
	assert.deepEqual(placements.map(item => item.frames), [1]);
	const next = renderReadyFrame(instance, request(['right', 'current']));
	assert.deepEqual(next.get('right'), uniform(1));
	assert.deepEqual(next.get('current'), uniform(2));
	instance.dispose();
	instance.dispose();
	assert.deepEqual(placements, [{ frames: 2, disposals: 1 }, { frames: 1, disposals: 1 }]);
	assert.throws(() => instance.render({}));
});

// 【入れ子の使わない公開入力へ接続した履歴は進めない】
// 子が公開入力を直結するだけなら親も借用値を返せる。別ポートのためだけにある
// Native Effectは、出力寸法の問い合わせでもインスタンスを確保しない。
test('passes through public values and leaves unused upstream history untouched', () => {
	const child = {
		...historyDefinition, nodes: [], paramDefs: { first: scalarParameter, other: scalarParameter },
		outputs: { current: publicParameter('first'), previous: publicParameter('other') },
	};
	const { instance, placements } = createHistoryFixture({
		...historyDefinition, paramDefs: { value: scalarParameter },
		nodes: [historyNode, {
			id: 'child', effectSource: { type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: child },
			params: { first: publicParameter('value'), other: nodePort('history', 'current') },
		}],
		outputs: { current: nodePort('child', 'current'), previous: nodePort('child', 'previous') },
	});
	const borrowed = uniform(17);
	assert.equal(instance.getOutputResolution('current'), null);
	const result = renderReadyFrame(instance, request(['current'], { value: borrowed }));
	assert.equal(result.get('current'), borrowed);
	assert.equal(placements.length, 0);
	assert.deepEqual(renderReadyFrame(instance, request(['previous'])).get('previous'), uniform(1));
	instance.dispose();
});

// 【画像を読む接続でサンプリングを選び、定数とテクスチャを同じチャンネル規則で読む】
// グラフの公開境界でフィルターを適用すると、同じテクスチャを異なる設定で読むことができない。
// scalarの定数もrテクスチャと同様、any入力で読む際には不足成分を(0, 0, 1)で補う。
test('applies sampling at each leaf and expands connected scalar uniforms like textures', () => {
	const reader = {
		kind: 'modify', paramDefs: { value: { ...scalarParameter, dataType: { kind: 'any' }, defaultValue: { inputSource: 'literal', value: null } } },
		outputDefs: { out: { dataType: { kind: 'any' } } }, primaryInputId: 'value', primaryOutputId: 'out',
	};
	const nodes = ['nearest', 'linear'].map(filterMode => ({
		id: filterMode, effectSource: { type: 'nativeEffect', id: 'reader' },
		params: { value: { ...publicParameter('scalar'), sampling: { fitMode: 'stretch', wrapMode: 'clamp', filterMode } } },
	}));
	const graph = {
		...reader, paramDefs: { scalar: scalarParameter }, primaryInputId: 'scalar', primaryOutputId: 'nearest', nodes,
		outputDefs: Object.fromEntries(nodes.map(node => [node.id, reader.outputDefs.out])),
		outputs: Object.fromEntries(nodes.map(node => [node.id, nodePort(node.id, 'out')])),
	};
	const inputs = [];
	const texture = {};
	const sourceSize = { width: 5, height: 7 };
	const instance = createEffectInstance({ type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: graph }, {
		catalog: { nativeEffects: new Map([['reader', reader]]), customShaderEffects: new Map(), customNodeGraphEffects: new Map() },
		enable32bitDataTextures: false, device: {}, resolution: { width: 2, height: 1 }, getInputResolution: () => sourceSize,
		nativeEffectImplementations: new Map([['reader', options => ({
			getOutputResolution: () => options.getInputResolution('value'),
			prepare({ params }) { inputs.push(params.value); return { outputs: new Map([['out', uniform(0)]]) }; },
			render() {},
			dispose() {},
		})]]),
	});
	assert.deepEqual(instance.getOutputResolution('nearest'), sourceSize);
	renderReadyFrame(instance, request(['nearest'], { scalar: -3 }));
	assert.deepEqual(inputs.shift(), { kind: 'uniform', value: [-3, 0, 0, 1] });
	renderReadyFrame(instance, request(['nearest', 'linear'], { scalar: { kind: 'texture', texture } }));
	assert.deepEqual(inputs.map(input => [input.texture, input.fitMode, input.wrapMode, input.filterMode]), [
		[texture, 'stretch', 'clamp', 'nearest'], [texture, 'stretch', 'clamp', 'linear'],
	]);
	instance.dispose();
});
