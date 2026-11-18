import { getNodeInputDataType } from '@gs/shared/data-type/node-compatibility.ts';
import type { CustomShaderEffect } from './custom-shader-effect.ts';

function validateShaderNames(ids: readonly string[], names: Readonly<Record<string, string>>): void {
	if (Object.keys(names).length !== ids.length) throw new Error('Custom Shader Effect port ID and name counts differ');
	const uniqueNames = new Set<string>();
	for (const id of ids) {
		const name = names[id];
		if (!Object.hasOwn(names, id) || typeof name !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name) || name.includes('__') || name.startsWith('gs_')) {
			throw new Error(`Invalid Custom Shader Effect port name for ${id}`);
		}
		if (uniqueNames.has(name)) throw new Error(`Duplicate Custom Shader Effect port name: ${name}`);
		uniqueNames.add(name);
	}
}

export function validateCustomShaderEffect(customShaderEffect: CustomShaderEffect): void {
	validateShaderNames(Object.keys(customShaderEffect.paramDefs), customShaderEffect.inputNames);
	validateShaderNames(Object.keys(customShaderEffect.outputDefs), customShaderEffect.outputNames);
	if (Object.keys(customShaderEffect.outputDefs).length === 0) throw new Error('Custom Shader Effect requires an output');
	for (const [id, parameter] of Object.entries(customShaderEffect.paramDefs)) {
		if (getNodeInputDataType(parameter) == null) throw new Error(`Custom Shader Effect requires a spatial input: ${id}`);
	}
}
