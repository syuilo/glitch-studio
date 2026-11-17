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
	id: 'layout', displayName: 'Layout', description: { 'ja-JP': 'テスト', 'en-US': 'Test' }, kind: 'generate', dependsOnRenderHistory: false, tags: [],
	paramDefs: { first: parameter, second: parameter, third: parameter },
	primaryInputParameter: null, resolutionInputParameters: [], outputDefs: {}, primaryOutput: null,
};
const section = (id, children) => ({ type: 'section', id, label: 'Section', children });

// 【表示用の入れ子と並べ替えは値の定義を変更しない】
// セクションとパラメータが混在しても、レンダラーへ渡す定義や参照キーをそのまま保つ。
// 実際のHeight Lightingの定義も読み込み、採用例の配置漏れを定義時に検出する。
test('accepts nested layouts independently of parameter definitions', () => {
	const layout = ['third', section('outer', [section('inner', ['second']), 'first'])];
	const result = defineEffect({ ...definition, ui: { parameterLayout: layout } });
	assert.equal(result.paramDefs, definition.paramDefs);
	assert.equal(result.ui.parameterLayout, layout);
	assert.equal(heightLighting.ui.parameterLayout[3].children[0].type, 'section');
	assert.equal(defineEffect(definition), definition);
	assert.doesNotThrow(() => defineEffect({ ...definition, paramDefs: {}, ui: { parameterLayout: [] } }));
});

// 【別のセクションへ同じパラメータを重複配置できない】
// 同じ値の編集UIや接続ポートが複数できると、開閉状態と配線の集約先が曖昧になる。
test('rejects duplicate parameter references across sections', () => {
	assert.throws(() => defineEffect({ ...definition, ui: { parameterLayout: ['first', section('outer', ['second', 'first']), 'third'] } }), /Duplicate parameter in layout: layout.first/);
});

// 【存在しないパラメータへの参照を定義時に拒否する】
// JavaScriptからの定義やキーの改名でも、編集画面を開くまで不正な参照を持ち越さない。
test('rejects unknown parameter references', () => {
	assert.throws(() => defineEffect({ ...definition, ui: { parameterLayout: [section('outer', ['missing'])] } }), /Unknown parameter in layout: layout.missing/);
});

// 【レイアウト指定時には全パラメータの配置を必要とする】
// パラメータ追加時の配置忘れで、編集できない設定が生じることを防ぐ。
test('rejects incomplete layouts', () => {
	assert.throws(() => defineEffect({ ...definition, ui: { parameterLayout: ['first'] } }), /Missing parameters in layout for layout: second, third/);
});

// 【セクションIDは入れ子の親が違ってもエフェクト内で一意にする】
// 開閉状態は親や表示名に依存せずIDで保持するため、別の枝に同じIDを許可しない。
test('rejects duplicate section IDs across branches', () => {
	const layout = [section('same', ['first']), section('outer', [section('same', ['second'])]), 'third'];
	assert.throws(() => defineEffect({ ...definition, ui: { parameterLayout: layout } }), /Duplicate parameter section ID: layout.same/);
});
