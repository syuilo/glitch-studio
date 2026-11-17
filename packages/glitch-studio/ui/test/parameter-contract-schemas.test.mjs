import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const directory = fileURLToPath(new URL('../', import.meta.url));
const effectDirectory = new URL('../../../subsystems/effect/shared/src/fx/', import.meta.url);
const effectNames = readdirSync(effectDirectory, { withFileTypes: true })
	.filter(entry => entry.isDirectory() && existsSync(new URL(`${entry.name}/_def_.ts`, effectDirectory)))
	.map(entry => entry.name).sort();
const bundled = await build({
	absWorkingDir: directory, bundle: true, platform: 'node', format: 'cjs', write: false,
	stdin: { resolveDir: directory, loader: 'ts', contents: `
		${effectNames.map((name, index) => `import definition${index} from '@gs/subsystems_effect_shared/fx/${name}/_def_.ts';`).join('\n')}
		export const effectDefinitions = [${effectNames.map((_name, index) => `definition${index}`).join(',')}];
		export { z } from 'zod';
		export { parameterDefinitionSchema, staticSettingDefinitionSchema } from './src/commands/parameter-contract-schemas.ts';
		export { visualModuleCustomParameterInputSchema, visualModuleSchema } from './src/commands/visual-module-contract-schemas.ts';
		export { parseProjectApiValue } from './src/project-api/contract.ts';
		export { createProjectVisualModule } from './src/utility/project-visual-module.ts';
	` },
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
const { z, effectDefinitions, parameterDefinitionSchema, staticSettingDefinitionSchema,
	visualModuleCustomParameterInputSchema, visualModuleSchema, parseProjectApiValue, createProjectVisualModule } = loaded.exports;

// 【すべての内蔵エフェクトの定義を公開契約で読み取れる】
// Query:getEffectの結果検証が、既存エフェクトの配列・構造体・Viewportや静的設定を
// 拒否すると資料を取得できなくなる。実際の定義を使い、スキーマとのずれを検出する。
test('accepts every built-in effect parameter and static setting definition', () => {
	for (const definition of effectDefinitions) {
		for (const [key, parameter] of Object.entries(definition.paramDefs)) {
			assert.doesNotThrow(() => parameterDefinitionSchema.parse(parameter), `${definition.id}.${key}`);
		}
		for (const [key, setting] of Object.entries(definition.staticSettingDefs ?? {})) {
			assert.doesNotThrow(() => staticSettingDefinitionSchema.parse(setting), `${definition.id}.${key}`);
		}
	}
});

// 【配列と構造体の初期展開指定を、入れ子も含めて公開契約で保持する】
// Queryや公開値定義の受け渡しで設定が欠落すると、UIが意図した初期状態を再現できない。
// コンテナを空の色コントロールとして受理してしまわず、内部まで検証する必要がある。
test('preserves and validates default expansion in nested container controls', () => {
	const definition = structuredClone(effectDefinitions.find(candidate => candidate.id === 'testStructArray').paramDefs.buzzs);
	definition.ui.control.defaultExpanded = false;
	definition.ui.control.element.defaultExpanded = false;
	assert.deepEqual(parameterDefinitionSchema.parse(definition).ui.control, definition.ui.control);
	definition.ui.control.element.defaultExpanded = 'collapsed';
	assert.equal(parameterDefinitionSchema.safeParse(definition).success, false);
	const struct = structuredClone(effectDefinitions.find(candidate => candidate.id === 'doublePendulumFractal').paramDefs.view);
	struct.ui.control.defaultExpanded = false;
	assert.deepEqual(parameterDefinitionSchema.parse(struct).ui.control, struct.ui.control);
});

// 【配列の保存構造とカスタムパラメータの制約をJSON資料に残す】
// JSONという説明だけでは配列要素のIDとBindingを組み立てられない。型付きの公開値と
// 内部共有値の違いも資料から判別でき、サポート外の定義を入力時に拒否する必要がある。
test('documents array element bindings and custom parameter restrictions', () => {
	const documentation = z.toJSONSchema(parameterDefinitionSchema, { io: 'input' });
	const array = documentation.anyOf.find(branch => branch.properties?.dataType.properties.kind.const === 'array');
	const value = array.properties.defaultValue.properties.value;
	assert.equal(value.type, 'array');
	assert.deepEqual(value.items.required, ['id', 'binding']);
	assert.equal(value.items.properties.id.type, 'string');
	assert.ok(value.items.properties.binding);
	assert.ok(array.properties.element);
	assert.ok(array.properties.ui.properties.control.properties.element);
	const customDocumentation = z.toJSONSchema(visualModuleCustomParameterInputSchema, { io: 'input' });
	for (const branch of customDocumentation.anyOf) {
		const restrictions = branch.properties;
		assert.ok((restrictions.canNode.allOf ?? [restrictions.canNode]).some(schema => schema.const === false));
		assert.deepEqual(restrictions.dataType.properties.kind.allOf.find(schema => schema.enum != null).enum,
			['scalar', 'bool', 'string', 'color', 'vector', 'enum', 'colorRamp', 'sizeReference']);
	}
	const custom = {
		nameForReference: 'amount', canNode: false, dataType: { kind: 'scalar' },
		ui: { label: 'Amount', control: { controlType: 'range', min: 0, max: 1 } },
		defaultValue: { inputSource: 'literal', value: 2.5 },
	};
	assert.equal(visualModuleCustomParameterInputSchema.safeParse(custom).success, true);
	assert.equal(visualModuleCustomParameterInputSchema.safeParse({ ...custom, canNode: true }).success, false);
	const arrayDefinition = effectDefinitions.find(definition => definition.id === 'testStructArray').paramDefs.buzzs;
	assert.equal(visualModuleCustomParameterInputSchema.safeParse({ ...arrayDefinition, nameForReference: 'items', canNode: false }).success, false);
});

// 【保存済みの参照・HDR値・省略された設定をQueryの契約で保持する】
// 削除した公開入力の参照はUndo用に残り、既存UIの接続にはサンプリングの省略形もある。
// 構造の検証で参照の実在性まで要求したり、資料にない追加情報を削除してはいけない。
test('preserves persisted Visual Module bindings and nullable modifiers', () => {
	const visualModule = createProjectVisualModule(0);
	const definition = effectDefinitions.find(candidate => candidate.id === 'testStructArray');
	const parameters = Object.fromEntries(Object.entries(definition.paramDefs).map(([key, parameter]) => [key, structuredClone(parameter.defaultValue)]));
	parameters.buzzs.value[0].binding.value.image = { inputSource: 'node', nodeId: 'removed-node', outputPort: 'removed-output' };
	parameters.buzzs.value[0].binding.value.x = { inputSource: 'literal', value: 4.5, expressionModifier: null };
	visualModule.nodes.push({
		id: 'effect', type: 'effect', effectId: definition.id, params: parameters, staticSettings: {},
		isBypass: false, resolution: { mode: 'auto', scale: 1 }, displayName: '',
	});
	visualModule.nodes.push({
		id: 'fill', type: 'effect', effectId: 'fill', staticSettings: {}, isBypass: false, displayName: '',
		resolution: { mode: 'auto', scale: 1 },
		params: { color: { inputSource: 'node', nodeId: 'removed-node', outputPort: 'removed-output' } },
	});
	visualModule.customParameterDefs.push({
		id: 'custom-color', nameForReference: 'hdr', canNode: false, dataType: { kind: 'color' },
		ui: { label: 'HDR', control: {} }, defaultValue: { inputSource: 'literal', value: [-1, 4.5, 0.5, 1] },
	});
	visualModule.customParameterValues['custom-color'] = {
		inputSource: 'keyframesTimelineInline', expressionModifier: null, trimmedDurationMs: null, offsetMode: 'start', wrapMode: 'repeat',
		keyframesTimeline: { dataType: { kind: 'color' }, isNormalized: true, keyframes: [
			{ id: 'key', x: 0, value: [-1, 4.5, 0.5, 1], interpolation: { type: 'ease:cubic', direction: 'inOut' } },
		] },
	};
	const original = structuredClone(visualModule);
	assert.equal(parseProjectApiValue(visualModuleSchema, visualModule, 'Visual Module'), visualModule);
	assert.deepEqual(visualModule, original);
	assert.equal(Object.hasOwn(visualModule, 'primaryAudioInputId'), false);
});
