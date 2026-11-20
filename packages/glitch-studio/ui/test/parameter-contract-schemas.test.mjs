import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const directory = fileURLToPath(new URL('../', import.meta.url));
const bundled = await build({
	absWorkingDir: directory, bundle: true, platform: 'node', format: 'cjs', write: false,
	stdin: { resolveDir: directory, loader: 'ts', contents: `
		export { nativeEffectDefinitions as effectDefinitions } from '@gs/subsystems_effect-new_native-effects/definitions.ts';
		export { z } from 'zod';
		export { parameterDefinitionSchema, staticSettingDefinitionSchema } from './src/commands/parameter-contract-schemas.ts';
		export { customNodeGraphEffectCustomParameterInputSchema, customNodeGraphEffectSchema } from './src/commands/custom-node-graph-effect-contract-schemas.ts';
		export { storedCustomNodeGraphEffectSchema } from './src/commands/effect-source-schema.ts';
		export { parseProjectApiValue } from './src/project-api/contract.ts';
		export { createProjectCustomNodeGraphEffect } from './src/utility/project-custom-node-graph-effect.ts';
	` },
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
const { z, effectDefinitions, parameterDefinitionSchema, staticSettingDefinitionSchema,
	customNodeGraphEffectCustomParameterInputSchema, customNodeGraphEffectSchema, parseProjectApiValue, createProjectCustomNodeGraphEffect } = loaded.exports;

// 【すべての内蔵エフェクトの定義を公開契約で読み取れる】
// Query:getEffectの結果検証が、既存エフェクトの配列・構造体・Viewportや静的設定を
// 拒否すると資料を取得できなくなる。実際の定義を使い、スキーマとのずれを検出する。
test('accepts every built-in effect parameter and static setting definition', () => {
	for (const definition of Object.values(effectDefinitions)) {
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
	const definition = structuredClone(effectDefinitions.testStructArray.paramDefs.buzzs);
	definition.ui.control.defaultExpanded = false;
	definition.ui.control.element.defaultExpanded = false;
	assert.deepEqual(parameterDefinitionSchema.parse(definition).ui.control, definition.ui.control);
	definition.ui.control.element.defaultExpanded = 'collapsed';
	assert.equal(parameterDefinitionSchema.safeParse(definition).success, false);
	const struct = structuredClone(effectDefinitions.doublePendulumFractal.paramDefs.view);
	struct.ui.control.defaultExpanded = false;
	assert.deepEqual(parameterDefinitionSchema.parse(struct).ui.control, struct.ui.control);
});

// 【配列・構造体の既定値とカスタムパラメータの制約を公開契約に反映する】
// 配列要素のIDとBindingの形を資料から組み立てられるようにし、動的な入力方式は配置で指定する。
// 型付きの公開値と内部共有値の違いも資料から判別でき、サポート外の定義を入力時に拒否する必要がある。
test('documents literal container defaults and custom parameter restrictions', () => {
	const documentation = z.toJSONSchema(parameterDefinitionSchema, { io: 'input' });
	const array = documentation.anyOf.find(branch => branch.properties?.dataType.properties.kind.const === 'array');
	const value = array.properties.defaultValue.properties.value;
	assert.equal(value.type, 'array');
	assert.deepEqual(value.items.required, ['id', 'binding']);
	assert.equal(value.items.properties.id.type, 'string');
	assert.equal(value.items.properties.binding.properties.inputSource.const, 'literal');
	assert.ok(array.properties.element);
	assert.ok(array.properties.ui.properties.control.properties.element);
	const customDocumentation = z.toJSONSchema(customNodeGraphEffectCustomParameterInputSchema, { io: 'input' });
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
	assert.equal(customNodeGraphEffectCustomParameterInputSchema.safeParse(custom).success, true);
	assert.equal(customNodeGraphEffectCustomParameterInputSchema.safeParse({ ...custom, canNode: true }).success, false);
	const arrayDefinition = effectDefinitions.testStructArray.paramDefs.buzzs;
	assert.equal(customNodeGraphEffectCustomParameterInputSchema.safeParse({ ...arrayDefinition, nameForReference: 'items', canNode: false }).success, false);
	const expression = { inputSource: 'expression', expression: 'TIME' };
	const invalidArray = structuredClone(arrayDefinition);
	invalidArray.defaultValue.value[0].binding = expression;
	assert.equal(parameterDefinitionSchema.safeParse(invalidArray).success, false);
	const invalidStruct = structuredClone(effectDefinitions.doublePendulumFractal.paramDefs.view);
	const field = Object.keys(invalidStruct.defaultValue.value)[0];
	invalidStruct.defaultValue.value[field] = expression;
	assert.equal(parameterDefinitionSchema.safeParse(invalidStruct).success, false);
});

// 【保存済みの参照・HDR値・省略された設定をQueryの契約で保持する】
// 削除した公開入力の参照はUndo用に残り、既存UIの接続にはサンプリングの省略形もある。
// 構造の検証で参照の実在性まで要求したり、資料にない追加情報を削除してはいけない。
test('preserves persisted Custom Node Graph Effect bindings and nullable modifiers', () => {
	const customNodeGraphEffect = createProjectCustomNodeGraphEffect(0).definition;
	const definition = effectDefinitions.testStructArray;
	const parameters = Object.fromEntries(Object.entries(definition.paramDefs).map(([key, parameter]) => [key, structuredClone(parameter.defaultValue)]));
	parameters.buzzs.value[0].binding.value.image = { inputSource: 'node', source: { nodeId: 'removed-node', outputPort: 'removed-output' }, sampling: { fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' } };
	parameters.buzzs.value[0].binding.value.x = { inputSource: 'literal', value: 4.5, expressionModifier: null };
	customNodeGraphEffect.nodes.push({
		id: 'effect', type: 'effect', effectSource: { type: 'nativeEffect', id: 'testStructArray' }, params: parameters, staticSettings: {},
		isBypass: false, resolution: { mode: 'auto', scale: 1 }, displayName: '',
	});
	customNodeGraphEffect.nodes.push({
		id: 'fill', type: 'effect', effectSource: { type: 'nativeEffect', id: 'fill' }, staticSettings: {}, isBypass: false, displayName: '',
		resolution: { mode: 'auto', scale: 1 },
		params: { color: { inputSource: 'node', source: { nodeId: 'removed-node', outputPort: 'removed-output' }, sampling: { fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' } } },
	});
	customNodeGraphEffect.customParameterDefs['custom-color'] = { nameForReference: 'hdr', canNode: false, dataType: { kind: 'color' },
		ui: { label: 'HDR', control: {} }, defaultValue: { inputSource: 'literal', value: [-1, 4.5, 0.5, 1] },
	};
	customNodeGraphEffect.customParameterValues['custom-color'] = {
		inputSource: 'keyframesTimelineInline', expressionModifier: null, trimmedDurationMs: null, offsetMode: 'start', wrapMode: 'repeat',
		keyframesTimeline: { dataType: { kind: 'color' }, isNormalized: true, keyframes: [
			{ id: 'key', x: 0, value: [-1, 4.5, 0.5, 1], interpolation: { type: 'ease:cubic', direction: 'inOut' } },
		] },
	};
	const original = structuredClone(customNodeGraphEffect);
	assert.equal(parseProjectApiValue(loaded.exports.storedCustomNodeGraphEffectSchema, customNodeGraphEffect, 'Custom Node Graph Effect'), customNodeGraphEffect);
	assert.deepEqual(customNodeGraphEffect, original);
	assert.equal(Object.hasOwn(customNodeGraphEffect, 'primaryAudioInputId'), false);
});
