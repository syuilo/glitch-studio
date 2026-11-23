import * as z from 'zod';
import { findTimelineLayerLocation } from '@gs/subsystems_timeline_shared/layer-tree.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { validateCustomShaderEffectDefinition } from '@gs/subsystems_effect_shared/custom-shader-effect.ts';
import { areProjectCustomShaderEffectsEqual, createProjectCustomShaderEffect } from '../utility/custom-shader-effect.ts';
import { isCustomShaderEffectUsed, reconcileCustomShaderEffectUsages } from '../utility/custom-shader-effect-usages.ts';
import { defineCommand, definePublicCommand } from './definition.ts';
import { projectCustomShaderEffectDefinitionSchema } from './project-contract-schemas.ts';
import { prepareProjectValueChange } from './prepared-value.ts';
import type { ProjectCustomShaderEffect } from '@gs/glitch-studio_shared/project/types.ts';
import type { ProjectState } from '../Project.ts';

function validateProjectCustomShaderEffect(definition: ProjectCustomShaderEffect): void {
	// UIの型付き入力以外からも呼び出す。作品側の文字列と実行方式を検証してから、
	// エフェクトドメインが所有する入出力・参照の検証へ渡す。
	for (const field of ['name', 'summary'] as const) {
		if (typeof definition[field] !== 'string') throw new Error(`Custom Shader Effect ${field} must be a string`);
	}
	if (typeof definition.definition.code !== 'string') throw new Error('Custom Shader Effect code must be a string');
	if (!['generate', 'modify'].includes(definition.definition.kind)) throw new Error('Invalid Custom Shader Effect kind');
	validateCustomShaderEffectDefinition(definition.definition);
}

function prepareCustomShaderEffectCreation(state: ProjectState, definition: ProjectCustomShaderEffect) {
	validateProjectCustomShaderEffect(definition);
	if (state.customShaderEffects.value.some(candidate => candidate.id === definition.id)) throw new Error('Duplicate Custom Shader Effect ID');
	const saved = deepClone(definition);
	return { result: { customShaderEffectId: saved.id }, change: {
		changes: [{ type: 'customShaderEffect' as const, customShaderEffectId: saved.id }],
		apply: (current: ProjectState) => { current.customShaderEffects.value.push(deepClone(saved)); },
		revert: (current: ProjectState) => { current.customShaderEffects.value = current.customShaderEffects.value.filter(candidate => candidate.id !== saved.id); },
	} };
}

const createCustomShaderEffect = definePublicCommand({
	label: 'Create Custom Shader Effect',
	inputSchema: z.object({ name: z.string().nullish() }), resultSchema: z.object({ customShaderEffectId: z.string() }),
	description: 'Create a project Custom Shader Effect with default WGSL code and generated input/output IDs. Omit name or pass null to generate a unique default name. The result is a reference for Query and Command APIs.',
	examples: ['let effect = Command:createCustomShaderEffect({ name: "My Effect" })\n<: Query:getCustomShaderEffect(effect)'],
	prepare(state, input) {
		const definition = createProjectCustomShaderEffect(state.customShaderEffects.value);
		if (input.name != null) definition.name = input.name;
		return prepareCustomShaderEffectCreation(state, definition);
	},
});

const duplicateCustomShaderEffect = definePublicCommand({
	label: 'Duplicate Custom Shader Effect',
	inputSchema: z.object({ customShaderEffectId: z.string().min(1), name: z.string().nullish() }), resultSchema: z.object({ customShaderEffectId: z.string() }),
	description: 'Duplicate a Custom Shader Effect with new Effect, parameter and output IDs. Internal references are remapped. Omit name or pass null to generate a unique name from the original.',
	examples: ['let effect = Command:createCustomShaderEffect({})\nlet copy = Command:duplicateCustomShaderEffect(effect)'],
	prepare(state, input) {
		const source = state.customShaderEffects.value.find(candidate => candidate.id === input.customShaderEffectId);
		if (source == null) throw new Error('Custom Shader Effect not found');
		const definition = createProjectCustomShaderEffect(state.customShaderEffects.value, source);
		if (input.name != null) definition.name = input.name;
		return prepareCustomShaderEffectCreation(state, definition);
	},
});

// デコード済み定義の登録専用。通常の作成・複製は呼び出し側でIDを組み立てない。
const insertCustomShaderEffect = defineCommand<{ definition: ProjectCustomShaderEffect }, { customShaderEffectId: string }>({
	label: 'Insert Custom Shader Effect',
	prepare: (state, { definition }) => prepareCustomShaderEffectCreation(state, definition),
});

const replaceCustomShaderEffectDefinition = definePublicCommand({
	label: 'Replace Custom Shader Effect definition',
	inputSchema: z.object({ customShaderEffectId: z.string().min(1), definition: projectCustomShaderEffectDefinitionSchema }), resultSchema: z.null(),
	description: 'Replace the full Custom Shader Effect definition while retaining its ID. Reconciles existing Node and Layer uses with changed inputs and outputs. Interface validation runs immediately; WGSL compilation is checked by the renderer.',
	examples: ['let effect = Command:createCustomShaderEffect({})\nlet definition = Obj:pick(Query:getCustomShaderEffect(effect), ["name", "summary", "definition"])\ndefinition.summary = "Updated summary"\nCommand:replaceCustomShaderEffectDefinition({ customShaderEffectId: effect.customShaderEffectId, definition: definition })'],
	prepare(state, { customShaderEffectId, definition }) {
		const beforeDefinition = state.customShaderEffects.value.find(candidate => candidate.id === customShaderEffectId);
		if (beforeDefinition == null) throw new Error('Custom Shader Effect not found');
		const afterDefinition = { ...definition, id: customShaderEffectId };
		validateProjectCustomShaderEffect(afterDefinition);
		const { nodesEffectChanges, layers } = reconcileCustomShaderEffectUsages(state, beforeDefinition, afterDefinition);
		// Undoで元に戻す範囲を、実際に補正したNodes Effectとレイヤーに絞る。
		return prepareProjectValueChange({
			before: { definition: beforeDefinition, nodesEffects: nodesEffectChanges.map(({ before }) => before), layers: layers.map(({ sceneId, before }) => ({ sceneId, layer: before })) },
			after: { definition: afterDefinition, nodesEffects: nodesEffectChanges.map(({ after }) => after), layers: layers.map(({ sceneId, after }) => ({ sceneId, layer: after })) },
			// Node・Layer の更新は定義の変更からのみ生じる。
			equals: (before, after) => areProjectCustomShaderEffectsEqual(before.definition, after.definition),
			result: undefined, changes: [
				{ type: 'customShaderEffect', customShaderEffectId },
				...nodesEffectChanges.map(({ after }) => ({ type: 'nodesEffect' as const, target: { nodesEffectId: after.id } })),
				...layers.map(({ sceneId, after }) => ({ type: 'layer' as const, sceneId, layerId: after.id, changes: [{ type: 'definition' as const }] })),
			],
			write(current, next) {
				current.customShaderEffects.value[current.customShaderEffects.value.findIndex(candidate => candidate.id === customShaderEffectId)] = next.definition;
				for (const nodesEffect of next.nodesEffects) current.nodesEffects.value[current.nodesEffects.value.findIndex(candidate => candidate.id === nodesEffect.id)] = nodesEffect;
				for (const { sceneId, layer } of next.layers) {
					const scene = current.timelineScenes.value.find(scene => scene.id === sceneId)!;
					const location = findTimelineLayerLocation(scene.layers, layer.id)!;
					location.siblings[location.index] = layer;
				}
			},
		});
	},
});

const removeCustomShaderEffect = definePublicCommand({
	label: 'Remove Custom Shader Effect',
	inputSchema: z.object({ customShaderEffectId: z.string().min(1) }),
	resultSchema: z.null(),
	description: 'Remove an unused Custom Shader Effect. Fails while any Node or Layer uses it; remove or replace those uses first.',
	examples: ['let effect = Command:createCustomShaderEffect({})\nCommand:removeCustomShaderEffect(effect)'],
	prepare(state, { customShaderEffectId }) {
		if (isCustomShaderEffectUsed(state, customShaderEffectId)) throw new Error('Custom Shader Effect is in use. Remove its Nodes and Layers first.');
		const index = state.customShaderEffects.value.findIndex(candidate => candidate.id === customShaderEffectId);
		if (index < 0) throw new Error('Custom Shader Effect not found');
		const saved = deepClone(state.customShaderEffects.value[index]);
		return {
			result: undefined,
			change: {
				changes: [{ type: 'customShaderEffect', customShaderEffectId }],
				apply: current => { current.customShaderEffects.value = current.customShaderEffects.value.filter(candidate => candidate.id !== customShaderEffectId); },
				revert: current => { current.customShaderEffects.value.splice(index, 0, deepClone(saved)); },
			},
		};
	},
});

export const CUSTOM_SHADER_EFFECT_COMMAND_DEFS = {
	createCustomShaderEffect, duplicateCustomShaderEffect, insertCustomShaderEffect,
	replaceCustomShaderEffectDefinition, removeCustomShaderEffect,
};
