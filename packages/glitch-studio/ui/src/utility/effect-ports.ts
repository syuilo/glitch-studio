import { isTextureDataType } from '@gs/shared/data-type/data-type.ts';
import { getArrayElementDefinition, getStructFieldDefinitions } from '@gs/shared/parameter/parameter-definition.ts';
import type { TextureDataType } from '@gs/shared/data-type/data-type.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';

type EffectPort = {
	key: string;
	label: string;
	dataType: TextureDataType;
	isPrimary: boolean;
};

// カードの表示と型での絞り込みで、同じ入出力を対象にする。
export function getEffectInputPorts(effect: Pick<EffectDefinition, 'paramDefs' | 'primaryInputParameter'>): EffectPort[] {
	return Object.entries(effect.paramDefs).flatMap(([key, definition]) =>
		getInputPorts(definition, [key], definition.ui.label, key === effect.primaryInputParameter));
}

export function getEffectOutputPorts(effect: Pick<EffectDefinition, 'outputDefs' | 'primaryOutput'>): EffectPort[] {
	return Object.entries(effect.outputDefs).map(([key, definition]) => ({
		key,
		label: key,
		dataType: definition.dataType,
		isPrimary: key === effect.primaryOutput,
	}));
}

function getInputPorts(definition: ParameterDefinition, path: string[], label: string, isPrimary = false): EffectPort[] {
	if (definition.dataType.kind === 'array') {
		// Pickerではまだ配列要素が確定していないため、初期値の個数ではなく要素の定義を1回表示する。
		return getInputPorts(getArrayElementDefinition(definition), path, `${label}[]`);
	}
	if (definition.dataType.kind === 'struct') {
		return Object.entries(getStructFieldDefinitions(definition)).flatMap(([key, field]) =>
			getInputPorts(field, [...path, key], `${label} / ${field.ui.label}`));
	}
	if (definition.canNode !== true || !isTextureDataType(definition.dataType)) return [];
	return [{
		key: JSON.stringify(path),
		label,
		dataType: definition.dataType,
		isPrimary,
	}];
}
