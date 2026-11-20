import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { genId } from '@gs/shared/utility/id.ts';
import type { ProjectCustomShaderEffect } from '@gs/glitch-studio_shared/project/types.ts';

export function createProjectCustomShaderEffect(definitions: readonly ProjectCustomShaderEffect[], source: ProjectCustomShaderEffect | null = null): ProjectCustomShaderEffect {
	const baseName = source?.name ?? 'Custom Shader Effect';
	let name = baseName;
	for (let suffix = 1; definitions.some(definition => definition.name === name); suffix++) name = `${baseName} ${suffix}`;
	if (source != null) {
		const copy = deepClone(source);
		const definition = copy.definition;
		const parameterIds = new Map(Object.keys(definition.paramDefs).map(id => [id, genId()]));
		const outputIds = new Map(Object.keys(definition.outputDefs).map(id => [id, genId()]));
		return { ...copy, id: genId(), name, definition: { ...definition,
			paramDefs: Object.fromEntries(Object.entries(definition.paramDefs).map(([id, def]) => [parameterIds.get(id)!, def])),
			outputDefs: Object.fromEntries(Object.entries(definition.outputDefs).map(([id, def]) => [outputIds.get(id)!, def])),
			primaryInputParameter: definition.primaryInputParameter == null ? null : parameterIds.get(definition.primaryInputParameter)!,
			primaryOutput: definition.primaryOutput == null ? null : outputIds.get(definition.primaryOutput)!,
			resolutionInputParameters: definition.resolutionInputParameters.map(id => parameterIds.get(id)!),
		} };
	}
	const inputId = genId();
	const outputId = genId();
	return {
		id: genId(),
		name,
		summary: '',
		definition: {
			shaderApiVersion: 1,
			kind: 'modify',
			code: 'fn main(position: vec2f) -> Output {\n\tvar output: Output;\n\toutput.color = read_source(position);\n\treturn output;\n}\n',
			paramDefs: { [inputId]: { nameForReference: 'source', canNode: true, dataType: { kind: 'color' }, ui: { label: 'Source', control: {} }, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } } },
			outputDefs: { [outputId]: { nameForReference: 'color', label: 'Color', dataType: { kind: 'color' } } },
			primaryInputParameter: inputId, primaryOutput: outputId, resolutionInputParameters: [inputId],
		},
	};
}
