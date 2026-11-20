import assert from 'node:assert/strict';
import { test } from 'node:test';
import { glob } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const directory = fileURLToPath(new URL('../', import.meta.url));
const effectDirectory = new URL('../../../subsystems/effect/native-effects/src/fx/', import.meta.url);
const effectNames = [];
for await (const path of glob('*/_def_.ts', { cwd: effectDirectory })) effectNames.push(path.split(/[\\/]/)[0]);
effectNames.sort();

const bundled = await build({
	absWorkingDir: directory, bundle: true, platform: 'node', format: 'cjs', write: false,
	stdin: { resolveDir: directory, loader: 'ts', contents: `
		export { createProjectScriptQueries } from './src/scripting/project-script-queries.ts';
		export { nativeEffectDefinitions as effectDefinitions } from '@gs/subsystems_effect_native-effects/definitions.ts';
	` },
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
const { createProjectScriptQueries, effectDefinitions } = loaded.exports;

// 【全ての実エフェクトの定義を契約付きQueryで取得できる】
// 単純なFillだけでは配列・構造体・静的設定・特殊なUI設定を検証できない。
// スキーマが正当な既存定義を拒否したり、未知扱いのフィールドを欠落させると、
// スクリプトが利用可能な入力を調べられなくなるため実際の登録内容と比較する。
test('queries every built-in Effect definition without rejecting or dropping its fields', () => {
	assert.ok(effectNames.length > 0);
	const query = createProjectScriptQueries({});
	const summaries = query['Query:listEffects']();
	assert.deepEqual(summaries.map(summary => summary.target.effectSource.id).sort(), effectNames);
	for (const { target, summary } of summaries) {
		const expected = effectDefinitions[target.effectSource.id];
		assert.deepEqual(summary, expected.summary, target.effectSource.id);
		const result = query['Query:getEffect'](target);
		assert.deepEqual(result, { target, ...expected, effectSource: target.effectSource }, target.effectSource.id);
		assert.notEqual(result.paramDefs, expected.paramDefs, target.effectSource.id);
		assert.notEqual(result.resolutionInputParameters, expected.resolutionInputParameters, target.effectSource.id);
		assert.equal(Object.isFrozen(result.resolutionInputParameters), false, target.effectSource.id);
		for (const [name, definition] of Object.entries(result.staticSettingDefs ?? {})) {
			if (definition.dataType.kind !== 'enum') continue;
			assert.notEqual(definition.dataType.options, expected.staticSettingDefs[name].dataType.options, target.effectSource.id);
			assert.equal(Object.isFrozen(definition.dataType.options), false, target.effectSource.id);
		}
	}
});
