import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';

const directory = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({
	absWorkingDir: directory, bundle: true, platform: 'node', format: 'cjs', write: false,
	stdin: { resolveDir: directory, loader: 'ts', contents: `
		export { defineEffect } from './src/effect-definition.ts';
		export { default as heightLighting } from './src/fx/heightLighting/_def_.ts';
	` },
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { defineEffect, heightLighting } = module.exports;
const parameter = { dataType: { kind: 'scalar' }, ui: { label: 'Value', control: { controlType: 'number' } }, defaultValue: { inputSource: 'literal', value: 0 } };
const definition = {
	id: 'layout', displayName: 'Layout', summary: { 'ja-JP': 'テスト', 'en-US': 'Test' }, kind: 'generate', dependsOnRenderHistory: false, tags: [],
	paramDefs: { first: parameter, second: parameter, third: parameter },
	primaryInputParameter: null, resolutionInputParameters: [], outputDefs: {}, primaryOutput: null,
};
const section = (id, children) => ({ type: 'section', id, label: 'Section', children });

// 【表示用の入れ子と並べ替えは値の定義を変更しない】
// セクションとパラメータが混在しても、レンダラーへ渡す定義や参照キーをそのまま保つ。
// 実際のHeight Lightingの定義も読み込み、入れ子のセクションが保持されることを確認する。
test('accepts nested layouts independently of parameter definitions', () => {
	const layout = ['third', section('outer', [section('inner', ['second']), 'first'])];
	const result = defineEffect({ ...definition, ui: { parameterLayout: layout } });
	assert.equal(result.paramDefs, definition.paramDefs);
	assert.equal(result.ui.parameterLayout, layout);
	assert.equal(heightLighting.ui.parameterLayout[3].children[0].type, 'section');
	assert.equal(defineEffect(definition), definition);
	assert.doesNotThrow(() => defineEffect({ ...definition, paramDefs: {}, ui: { parameterLayout: [] } }));
});
