import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadSource } from './helpers/load-source.mjs';

const { getEffectLayerParameterDefault, validateTimelineEffectLayer } = await loadSource(fileURLToPath(new URL('../src/layers/effect/effect-layer.ts', import.meta.url)));
const color = { dataType: { kind: 'color' }, canNode: true, ui: { label: 'Input', control: {} }, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } };
const definition = { kind: 'modify', paramDefs: { input: color }, primaryInputParameter: 'input', primaryOutput: 'out',
	outputDefs: { out: { dataType: { kind: 'color' } } }, resolutionInputParameters: ['input'] };
const definitions = { getNativeEffect: () => definition };
const layer = { layerType: 'effect', effectSource: { type: 'nativeEffect', id: 'filter' }, effectParamValues: {}, effectStaticSettings: {}, resolution: { mode: 'auto', scale: 1 } };

// 【加工系の画像入力と主音声入力をTimelineの下層へ接続する】
// 画像・音声とも配置時にだけ供給元が変わる。Graph内で同じ定義を使う場合の既定色は保持する。
test('uses Timeline defaults at the placement boundary', () => {
	assert.deepEqual(getEffectLayerParameterDefault(definition, 'input'), { inputSource: 'lowerLayerOutput' });
	assert.deepEqual(getEffectLayerParameterDefault({ ...definition, primaryAudioInputParameter: 'audio' }, 'audio'), { inputSource: 'lowerLayerAudio' });
	assert.deepEqual(getEffectLayerParameterDefault({ ...definition, kind: 'generate' }, 'input'), color.defaultValue);
	validateTimelineEffectLayer(layer, definitions);
});

// 【Timelineはデータ出力を暗黙に色として合成しない】
// 色ポートが存在しても、指定されたプライマリ出力がデータまたは未指定なら配置できない。
test('requires the designated primary output to carry color', () => {
	for (const primaryOutput of [null, 'data']) {
		const invalid = { ...definition, primaryOutput, outputDefs: { ...definition.outputDefs, data: { dataType: { kind: 'scalar' } } } };
		assert.throws(() => validateTimelineEffectLayer(layer, { getNativeEffect: () => invalid }), /primary color output/);
	}
});
