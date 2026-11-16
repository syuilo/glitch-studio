import { isCustomShaderEffectUsed, snapshotCustomShaderEffectUsages, reconcileCustomShaderEffectUsages } from '../utility/custom-shader-effect-usages.ts';
import { createProjectCustomShaderEffect } from '../utility/custom-shader-effect.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { deepEqual } from '@gs/shared/utility/deep-equal.ts';
import { validateCustomShaderEffectDefinition } from '@gs/subsystems_effect_shared/custom-shader-effect-definition.ts';
import type { ProjectCustomShaderEffect } from '@gs/glitch-studio_shared/project/types.ts';
import type { ProjectState } from '../Project.ts';
import { defineCommand } from './definition.ts';
import { prepareProjectValueChange } from './prepared-value.ts';

function validateProjectCustomShaderEffect(definition: ProjectCustomShaderEffect): void {
	// UIの型付き入力以外からも呼び出す。作品側の文字列と実行方式を検証してから、
	// エフェクトドメインが所有する入出力・参照の検証へ渡す。
	for (const field of ['name', 'description', 'code'] as const) {
		if (typeof definition[field] !== 'string') throw new Error(`Custom Shader Effect ${field} must be a string`);
	}
	if (!['wgsl'].includes(definition.codeLanguage)) throw new Error('Unsupported Custom Shader Effect code language');
	if (!['generate', 'modify'].includes(definition.kind)) throw new Error('Invalid Custom Shader Effect kind');
	validateCustomShaderEffectDefinition(definition);
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

const createCustomShaderEffect = defineCommand<{ name?: string }, { customShaderEffectId: string }>({
	label: 'Create Custom Shader Effect',
	prepare(state, input) {
		const definition = createProjectCustomShaderEffect(state.customShaderEffects.value);
		if (input.name != null) definition.name = input.name;
		return prepareCustomShaderEffectCreation(state, definition);
	},
});

const duplicateCustomShaderEffect = defineCommand<{ customShaderEffectId: string; name?: string }, { customShaderEffectId: string }>({
	label: 'Duplicate Custom Shader Effect',
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

const replaceCustomShaderEffectDefinition = defineCommand<{ customShaderEffectId: string; definition: Omit<ProjectCustomShaderEffect, 'id'> }>({
	label: 'Replace Custom Shader Effect definition',
	prepare(state, { customShaderEffectId, definition }) {
		const beforeDefinition = state.customShaderEffects.value.find(candidate => candidate.id === customShaderEffectId);
		if (beforeDefinition == null) throw new Error('Custom Shader Effect not found');
		const afterDefinition = { ...definition, id: customShaderEffectId };
		validateProjectCustomShaderEffect(afterDefinition);
		const beforeUsages = snapshotCustomShaderEffectUsages(state);
		const afterUsages = reconcileCustomShaderEffectUsages(state, beforeDefinition, afterDefinition);
		// 定義変更が実際に影響した作品だけを履歴に保持する。他の作品をUndoで置換しない。
		const visualModuleIds = new Set(afterUsages.visualModules.filter((value, index) => !deepEqual(value, beforeUsages.visualModules[index])).map(value => value.id));
		const sceneIds = new Set(afterUsages.timelineScenes.filter((value, index) => !deepEqual(value, beforeUsages.timelineScenes[index])).map(value => value.id));
		return prepareProjectValueChange({
			before: { definition: beforeDefinition, visualModules: beforeUsages.visualModules.filter(value => visualModuleIds.has(value.id)), timelineScenes: beforeUsages.timelineScenes.filter(value => sceneIds.has(value.id)) },
			after: { definition: afterDefinition, visualModules: afterUsages.visualModules.filter(value => visualModuleIds.has(value.id)), timelineScenes: afterUsages.timelineScenes.filter(value => sceneIds.has(value.id)) },
			result: undefined, changes: [{ type: 'customShaderEffect', customShaderEffectId }],
			write(current, next) {
				current.customShaderEffects.value[current.customShaderEffects.value.findIndex(candidate => candidate.id === customShaderEffectId)] = next.definition;
				for (const visualModule of next.visualModules) current.visualModules.value[current.visualModules.value.findIndex(candidate => candidate.id === visualModule.id)] = visualModule;
				for (const scene of next.timelineScenes) current.timelineScenes.value[current.timelineScenes.value.findIndex(candidate => candidate.id === scene.id)] = scene;
			},
		});
	},
});

const removeCustomShaderEffect = defineCommand<{ customShaderEffectId: string }>({
	label: 'Remove Custom Shader Effect',
	prepare(state, { customShaderEffectId }) {
		if (isCustomShaderEffectUsed(state, customShaderEffectId)) throw new Error('Custom Shader Effect is in use. Remove its Nodes and Layers first.');
		const index = state.customShaderEffects.value.findIndex(candidate => candidate.id === customShaderEffectId);
		if (index < 0) throw new Error('Custom Shader Effect not found');
		const saved = deepClone(state.customShaderEffects.value[index]);
		return { result: undefined, change: { changes: [{ type: 'customShaderEffect', customShaderEffectId }],
			apply: current => { current.customShaderEffects.value = current.customShaderEffects.value.filter(candidate => candidate.id !== customShaderEffectId); },
			revert: current => { current.customShaderEffects.value.splice(index, 0, deepClone(saved)); },
		} };
	},
});

export const CUSTOM_SHADER_EFFECT_COMMAND_DEFS = {
	createCustomShaderEffect, duplicateCustomShaderEffect, insertCustomShaderEffect,
	replaceCustomShaderEffectDefinition, removeCustomShaderEffect,
};
