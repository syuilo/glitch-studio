import assert from 'node:assert/strict';
import { test } from 'node:test';
import { glob } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const directory = fileURLToPath(new URL('../', import.meta.url));
const effectDirectory = new URL('../../../subsystems/effect/shared/src/fx/', import.meta.url);
const effectNames = [];
for await (const path of glob('*/_def_.ts', { cwd: effectDirectory })) effectNames.push(path.split(/[\\/]/)[0]);
effectNames.sort();

const bundled = await build({
	absWorkingDir: directory, bundle: true, platform: 'node', format: 'cjs', write: false,
	stdin: { resolveDir: directory, loader: 'ts', contents: `
		export { createProjectScriptQueries } from './src/scripting/project-script-queries.ts';
		export { effectDefinitions } from '@gs/subsystems_effect_shared/effect-definitions.ts';
	` },
	plugins: [{ name: 'actual-effect-definitions', setup(builder) {
		// Viteのglob登録だけをNode用に展開する。定義そのものや子のパラメータは
		// 差し替えず、エフェクト追加時もこのテストの対象へ自動的に含める。
		builder.onResolve({ filter: /effect-definitions\.[jt]s$/ }, () => ({ path: 'effects', namespace: 'actual-effect-definitions' }));
		builder.onLoad({ filter: /.*/, namespace: 'actual-effect-definitions' }, () => ({
			loader: 'ts', resolveDir: directory, contents: [
				...effectNames.map((name, index) => `import effect${index} from ${JSON.stringify(`@gs/subsystems_effect_shared/fx/${name}/_def_.ts`)};`),
				`export const effectDefinitions = { ${effectNames.map((name, index) => `${JSON.stringify(name)}: effect${index}`).join(', ')} };`,
			].join('\n'),
		}));
	} }],
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
	assert.deepEqual(summaries.map(summary => summary.target.effectId), effectNames);
	for (const { target } of summaries) {
		const expected = effectDefinitions[target.effectId];
		const result = query['Query:getEffect'](target);
		assert.deepEqual(result, { target, ...expected }, target.effectId);
		assert.notEqual(result.paramDefs, expected.paramDefs, target.effectId);
		assert.notEqual(result.resolutionInputParameters, expected.resolutionInputParameters, target.effectId);
		assert.equal(Object.isFrozen(result.resolutionInputParameters), false, target.effectId);
		for (const [name, definition] of Object.entries(result.staticSettingDefs ?? {})) {
			if (definition.dataType.kind !== 'enum') continue;
			assert.notEqual(definition.dataType.options, expected.staticSettingDefs[name].dataType.options, target.effectId);
			assert.equal(Object.isFrozen(definition.dataType.options), false, target.effectId);
		}
	}
});
