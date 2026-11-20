import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defineNativeEffect } from '@gs/subsystems_effect-new_shared/effect-definition.ts';
import heightLighting from '../src/fx/heightLighting/_def_.ts';

const parameter = { dataType: { kind: 'scalar' }, ui: { label: 'Value', control: { controlType: 'number' } }, defaultValue: { inputSource: 'literal', value: 0 } };
const definition = {
	displayName: 'Layout', summary: { 'ja-JP': 'テスト', 'en-US': 'Test' }, kind: 'generate', dependsOnRenderHistory: false, tags: [],
	paramDefs: { first: parameter, second: parameter, third: parameter },
	primaryInputParameter: null, resolutionInputParameters: [], outputDefs: {}, primaryOutput: null,
};
const section = (id, children) => ({ type: 'section', id, label: 'Section', children });

// 【表示用の入れ子と並べ替えは値の定義を変更しない】
// セクションとパラメータが混在しても、レンダラーへ渡す定義や参照キーをそのまま保つ。
// 実際のHeight Lightingの定義も読み込み、入れ子のセクションが保持されることを確認する。
test('accepts nested layouts independently of parameter definitions', () => {
	const layout = ['third', section('outer', [section('inner', ['second']), 'first'])];
	const result = defineNativeEffect({ ...definition, ui: { parameterLayout: layout } });
	assert.equal(result.paramDefs, definition.paramDefs);
	assert.equal(result.ui.parameterLayout, layout);
	assert.equal(heightLighting.ui.parameterLayout[3].children[0].type, 'section');
	assert.equal(defineNativeEffect(definition), definition);
	assert.doesNotThrow(() => defineNativeEffect({ ...definition, paramDefs: {}, ui: { parameterLayout: [] } }));
});
