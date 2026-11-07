import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { genId } from '@gs/shared/utility/id.ts';
import type { ProjectCustomShaderEffect } from '@gs/glitch-studio_shared/project/types.ts';

export function createProjectCustomShaderEffect(definitions: readonly ProjectCustomShaderEffect[], source: ProjectCustomShaderEffect | null = null): ProjectCustomShaderEffect {
	const baseName = source?.name ?? 'Custom Shader Effect';
	let name = baseName;
	for (let suffix = 1; definitions.some(definition => definition.name === name); suffix++) name = `${baseName} ${suffix}`;
	if (source != null) {
		const copy = deepClone(source);
		const ids = new Map([...copy.paramDefs, ...copy.outputDefs].map(definition => [definition.id, genId()]));
		return {
			...copy,
			id: genId(),
			name,
			paramDefs: copy.paramDefs.map(parameter => ({ ...parameter, id: ids.get(parameter.id)! })),
			outputDefs: copy.outputDefs.map(output => ({ ...output, id: ids.get(output.id)! })),
			primaryInputId: copy.primaryInputId == null ? null : ids.get(copy.primaryInputId)!,
			primaryOutputId: copy.primaryOutputId == null ? null : ids.get(copy.primaryOutputId)!,
			resolutionInputIds: copy.resolutionInputIds.map(id => ids.get(id)!),
		};
	}
	const inputId = genId();
	const outputId = genId();
	return {
		id: genId(),
		name,
		description: '',
		shaderApiVersion: 1,
		kind: 'modify',
		codeLanguage: 'wgsl',
		code: 'fn main(position: vec2f) -> Output {\n\tvar output: Output;\n\toutput.color = read_source(position);\n\treturn output;\n}\n',
		paramDefs: [{ id: inputId, nameForReference: 'source', canNode: true, dataType: { kind: 'color' }, ui: { label: 'Source', control: {} }, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } }],
		outputDefs: [{ id: outputId, nameForReference: 'color', label: 'Color', dataType: { kind: 'color' } }],
		primaryInputId: inputId, primaryOutputId: outputId, resolutionInputIds: [inputId],
	};
}
