import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/parameter/parameter-default.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false });
const { createDefaultParameterBinding, isParameterBindingDefault } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const literal = value => ({ inputSource: 'literal', value });
const scalar = { dataType: { kind: 'scalar' }, defaultValue: 0 };

// 【既定状態の判定は評価値ではなく入力方式と保存した設定を比較する】
// 現在は同じ値を返す式やキーも、別時刻の結果や編集意図を失わないよう変更として扱う。
test('compares stored values and input sources without evaluating bindings', () => {
	assert.equal(isParameterBindingDefault(scalar, literal(0)), true);
	assert.equal(isParameterBindingDefault(scalar, literal(1)), false);
	for (const binding of [
		{ inputSource: 'expression', expression: '0' },
		{ inputSource: 'envVariable', variable: 'TIME' },
		{ inputSource: 'node', nodeId: 'source', outputPort: 'output' },
		{ inputSource: 'keyframesTimelineInline', keyframesTimeline: { keyframes: [] } },
		{ inputSource: 'curveAnimationInline', curveAnimation: { curveBinding: { source: 'reference', curveId: null }, yRangeMin: null, yRangeMax: null, trimmedDurationMs: null, wrapMode: 'clamp', offsetMode: 'start' } },
	]) assert.equal(isParameterBindingDefault(scalar, binding), false);
});

// 【利用場所固有の既定接続を渡せて、接続設定の差も検出する】
// Timelineの初期入力はliteralではない。共通処理へTimelineの知識を持ち込まず比較する。
test('accepts domain defaults and compares all connection settings', () => {
	const baseline = { inputSource: 'lowerLayerOutput', fitMode: 'cover', wrapMode: 'clamp' };
	assert.equal(isParameterBindingDefault(scalar, { ...baseline }, baseline), true);
	assert.equal(isParameterBindingDefault(scalar, { ...baseline, fitMode: 'contain' }, baseline), false);
	assert.equal(isParameterBindingDefault(scalar, literal(0), baseline), false);
});

// 【加工なしの省略とnullは同じにし、無効化中の加工式も変更として保持する】
// 実行時の有効性だけで比較すると、保存された本文がある行を隠してしまう。
test('normalizes absent modifiers but preserves disabled modifier settings', () => {
	assert.equal(isParameterBindingDefault(scalar, { ...literal(0), expressionModifier: null }), true);
	assert.equal(isParameterBindingDefault(scalar, { ...literal(0), expressionModifier: undefined }), true);
	for (const enabled of [false, true]) assert.equal(isParameterBindingDefault(scalar, { ...literal(0), expressionModifier: { enabled, code: 'VALUE' } }), false);
});

// 【配列のIDだけの差を無視し、順序・個数・子の式や値の差は検出する】
// リセットでIDが変わっても既定状態へ戻せる一方、実際の設定の変化は見逃さない。
test('compares nested array contents in order independently of element IDs', () => {
	const definition = { dataType: { kind: 'array', elementType: { kind: 'struct', fields: { amount: scalar.dataType } } },
		defaultValue: [{ amount: 0 }, { amount: 2 }] };
	const binding = createDefaultParameterBinding(definition);
	binding.value.forEach(element => { element.id += '-reset'; });
	const before = structuredClone(binding);
	assert.equal(isParameterBindingDefault(definition, binding), true);
	assert.deepEqual(binding, before);
	assert.equal(isParameterBindingDefault(definition, literal([...binding.value].reverse())), false);
	assert.equal(isParameterBindingDefault(definition, literal(binding.value.slice(1))), false);
	binding.value[0].binding.value.amount = { inputSource: 'expression', expression: '0' };
	assert.equal(isParameterBindingDefault(definition, binding), false);
});

// 【コンテナ全体の既定値を子の単独の既定値から区別する】
// 親を初期化した場合、子を単体でリセットした場合と異なる値を持てる。
test('uses the parent default contents when comparing children', () => {
	const definition = { dataType: { kind: 'struct', fields: { amount: scalar.dataType } }, fields: { amount: { defaultValue: 0 } }, defaultValue: { amount: 2 } };
	assert.equal(isParameterBindingDefault(definition, literal({ amount: literal(2) })), true);
	assert.equal(isParameterBindingDefault(definition, literal({ amount: literal(0) })), false);
});
