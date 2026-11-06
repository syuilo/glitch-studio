import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { validateCustomShaderEffectDefinition } from '@gs/subsystems_effect_shared/custom-shader-effect-definition.ts';
import type { ProjectCustomShaderEffect } from '@gs/glitch-studio_shared/project/types.ts';
import type { CommandDef } from '../commands.ts';

const addCustomShaderEffect = {
	label: 'Add Custom Shader Effect',
	changes: (_state, { customShaderEffect }) => [{ type: 'customShaderEffect', customShaderEffectId: customShaderEffect.id }],
	create: ({ customShaderEffect }) => ({
		execute(state) {
			validateCustomShaderEffectDefinition(customShaderEffect);
			if (state.customShaderEffects.value.some(definition => definition.id === customShaderEffect.id)) throw new Error('Duplicate Custom Shader Effect ID');
			state.customShaderEffects.value.push(deepClone(customShaderEffect));
		},
		undo(state) { state.customShaderEffects.value = state.customShaderEffects.value.filter(definition => definition.id !== customShaderEffect.id); },
	}),
} satisfies CommandDef<{ customShaderEffect: ProjectCustomShaderEffect }>;

const updateCustomShaderEffect = {
	label: 'Apply Custom Shader Effect definition',
	changes: (_state, { customShaderEffect }) => [{ type: 'customShaderEffect', customShaderEffectId: customShaderEffect.id }],
	create: ({ customShaderEffect }) => {
		let before: ProjectCustomShaderEffect;
		return {
			execute(state) {
				validateCustomShaderEffectDefinition(customShaderEffect);
				const index = state.customShaderEffects.value.findIndex(definition => definition.id === customShaderEffect.id);
				if (index < 0) throw new Error('Custom Shader Effect not found');
				// コードと入出力を一つの履歴で交換し、Undoで異なる世代の組み合わせを作らない。
				before = deepClone(state.customShaderEffects.value[index]);
				state.customShaderEffects.value[index] = deepClone(customShaderEffect);
			},
			undo(state) {
				const index = state.customShaderEffects.value.findIndex(definition => definition.id === customShaderEffect.id);
				state.customShaderEffects.value[index] = deepClone(before);
			},
		};
	},
} satisfies CommandDef<{ customShaderEffect: ProjectCustomShaderEffect }>;

const removeCustomShaderEffect = {
	label: 'Remove Custom Shader Effect',
	changes: (_state, { customShaderEffectId }) => [{ type: 'customShaderEffect', customShaderEffectId }],
	create: ({ customShaderEffectId }) => {
		let before: ProjectCustomShaderEffect;
		let index: number;
		return {
			execute(state) {
				index = state.customShaderEffects.value.findIndex(definition => definition.id === customShaderEffectId);
				if (index < 0) throw new Error('Custom Shader Effect not found');
				before = deepClone(state.customShaderEffects.value[index]);
				state.customShaderEffects.value.splice(index, 1);
			},
			undo(state) { state.customShaderEffects.value.splice(index, 0, deepClone(before)); },
		};
	},
} satisfies CommandDef<{ customShaderEffectId: string }>;

export const CUSTOM_SHADER_EFFECT_COMMAND_DEFS = { addCustomShaderEffect, updateCustomShaderEffect, removeCustomShaderEffect };
