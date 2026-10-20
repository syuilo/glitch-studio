import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundled = await build({
	stdin: {
		contents: "export { COMMAND_DEFS } from './commands.ts';",
		resolveDir: fileURLToPath(new URL('../src/', import.meta.url)), loader: 'ts',
	},
	bundle: true, platform: 'node', format: 'cjs', write: false,
	plugins: [{ name: 'auto-connect-dependencies', setup(build) {
		build.onResolve({ filter: /preferences\.ts$|effect-definitions\.[jt]s$/ }, ({ path }) => ({ path, external: true }));
	} }],
});

function fixture(enabled = false, inline = false) {
	const preferences = { s: { visualModuleAutoConnectOnNodeAdd: enabled, forceTypeSafety: true } };
	const disconnected = { inputSource: 'node', nodeId: null, outputPort: null };
	const effectDefinitions = {
		previous: { outputDefs: { main: { dataType: { kind: 'color' } }, secondary: { dataType: { kind: 'color' } } } },
		filter: { primaryInputParameter: 'image', primaryOutput: 'result',
			paramDefs: { image: { canNode: true, dataType: { kind: 'color' }, defaultValue: disconnected } },
			outputDefs: { result: { dataType: { kind: 'color' } } } },
		scalar: { primaryInputParameter: 'value', primaryOutput: 'result',
			paramDefs: { value: { canNode: true, dataType: { kind: 'scalar' }, defaultValue: disconnected } },
			outputDefs: { result: { dataType: { kind: 'scalar' } } } },
	};
	const module = { exports: {} };
	const require = createRequire(import.meta.url);
	new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(path => /preferences\.ts$/.test(path)
		? { preferences } : /effect-definitions\.[jt]s$/.test(path) ? { effectDefinitions } : require(path), module, module.exports);
	const visualModule = { id: 'visual-module', paramDefs: [], primaryOutputId: 'primary', outputDefs: [
		{ id: 'primary', dataType: { kind: 'color' } }, { id: 'other', dataType: { kind: 'color' } },
	], nodes: [
		{ id: 'previous', type: 'effect', effectId: 'previous', params: {} },
		{ id: 'out', type: 'globalOut', inputs: {
			primary: { nodeId: 'previous', outputPort: 'secondary' }, other: { nodeId: 'previous', outputPort: 'main' },
		} },
	] };
	const state = { visualModules: { value: inline ? [] : [visualModule] },
		timelineScenes: { value: [{ id: 'scene', layers: [{ id: 'inline', layerType: 'inlineVisualModule', visualModule }] }] } };
	const target = inline ? { sceneId: 'scene', inlineVisualModuleLayerId: 'inline' } : { visualModuleId: 'visual-module' };
	const command = (payload = {}) => module.exports.COMMAND_DEFS.addEffectNode.create({ ...target, id: 'added', effectId: 'filter', ...payload });
	return { preferences, visualModule, state, command, disconnected };
}

// 【自動接続を無効にした追加では既存の配線と入力の既定値を維持する】
// 従来の追加操作を既定の挙動として保ち、後から設定を有効にしてもRedoで接続が増えないようにする。
test('preserves wiring when disabled even after enabling before redo', () => {
	const f = fixture();
	const before = structuredClone(f.visualModule);
	const command = f.command();
	command.execute(f.state);
	assert.deepEqual(f.visualModule.nodes[1].params.image, f.disconnected);
	assert.deepEqual(f.visualModule.nodes.at(-1).inputs, before.nodes.at(-1).inputs);
	const after = structuredClone(f.visualModule);
	command.undo(f.state);
	assert.deepEqual(f.visualModule, before);
	f.preferences.s.visualModuleAutoConnectOnNodeAdd = true;
	command.execute(f.state);
	assert.deepEqual(f.visualModule, after);
});

// 【登録済み・インラインの主出力を追加ノードへつなぎ、副出力の接続元も維持する】
// 主出力以外の配線を変えず、Undoで元へ戻す。設定を無効にしてもRedoは追加時の接続を復元する。
test('connects primary ports and preserves secondary source ports through undo and redo', () => {
	for (const inline of [false, true]) {
		const f = fixture(true, inline);
		const before = structuredClone(f.visualModule);
		const command = f.command();
		command.execute(f.state);
		assert.deepEqual(f.visualModule.nodes.map(node => node.id), ['previous', 'added', 'out']);
		assert.deepEqual(f.visualModule.nodes[1].params.image, { inputSource: 'node', nodeId: 'previous', outputPort: 'secondary',
			fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' });
		assert.deepEqual(f.visualModule.nodes.at(-1).inputs.primary, { nodeId: 'added', outputPort: 'result' });
		assert.deepEqual(f.visualModule.nodes.at(-1).inputs.other, before.nodes.at(-1).inputs.other);
		const after = structuredClone(f.visualModule);
		command.undo(f.state);
		assert.deepEqual(f.visualModule, before);
		f.preferences.s.visualModuleAutoConnectOnNodeAdd = false;
		command.execute(f.state);
		assert.deepEqual(f.visualModule, after);
	}
});

// 【未接続・主出力なしでも追加でき、Undoで接続の未設定と明示的な解除を復元する】
// 初めて出力へ接続する場合や主出力を使わないVisual Moduleでも、追加前の状態を失わないようにする。
test('handles missing and disconnected primary outputs without losing their original state', () => {
	for (const mode of ['missing', 'disconnected', 'noPrimary', 'noGlobalOut']) {
		const f = fixture(true);
		if (mode === 'missing') delete f.visualModule.nodes.at(-1).inputs.primary;
		if (mode === 'disconnected') f.visualModule.nodes.at(-1).inputs.primary = { nodeId: null, outputPort: null };
		if (mode === 'noPrimary') f.visualModule.primaryOutputId = null;
		if (mode === 'noGlobalOut') f.visualModule.nodes.pop();
		const before = structuredClone(f.visualModule);
		const command = f.command();
		command.execute(f.state);
		assert.deepEqual(f.visualModule.nodes.find(node => node.id === 'added').params.image, f.disconnected);
		if (mode === 'missing' || mode === 'disconnected') {
			assert.deepEqual(f.visualModule.nodes.at(-1).inputs.primary, { nodeId: 'added', outputPort: 'result' });
		}
		command.undo(f.state);
		assert.deepEqual(f.visualModule, before);
	}
});

// 【型安全設定と明示的な入力値を尊重する】
// 自動接続で接続不能な入力・出力や、呼び出し側が指定した入力値を上書きしないようにする。
test('respects incompatible data types and explicitly supplied parameters', () => {
	const f = fixture(true);
	const inputs = structuredClone(f.visualModule.nodes.at(-1).inputs);
	f.command({ effectId: 'scalar' }).execute(f.state);
	assert.deepEqual(f.visualModule.nodes[1].params.value, f.disconnected);
	assert.deepEqual(f.visualModule.nodes.at(-1).inputs, inputs);
	const explicit = fixture(true);
	explicit.command({ params: { image: explicit.disconnected } }).execute(explicit.state);
	assert.deepEqual(explicit.visualModule.nodes[1].params.image, explicit.disconnected);
});
