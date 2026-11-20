import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { deepEqual } from '@gs/shared/utility/deep-equal.ts';
import { genId } from '@gs/shared/utility/id.ts';
import type { ProjectCustomShaderEffect } from '@gs/glitch-studio_shared/project/types.ts';
import type { EffectParameterLayoutItem } from '@gs/subsystems_effect-new_shared/effect-parameter-layout.ts';

export function areProjectCustomShaderEffectsEqual(before: ProjectCustomShaderEffect, after: ProjectCustomShaderEffect): boolean {
	// ポートの列挙順は入力の表示順と WGSL の Output 構造体のメンバー順を決める。
	return deepEqual(Object.keys(before.definition.paramDefs), Object.keys(after.definition.paramDefs))
		&& deepEqual(Object.keys(before.definition.outputDefs), Object.keys(after.definition.outputDefs))
		&& deepEqual(before, after);
}

export function createProjectCustomShaderEffect(definitions: readonly ProjectCustomShaderEffect[], source: ProjectCustomShaderEffect | null = null): ProjectCustomShaderEffect {
	const baseName = source?.name ?? 'Custom Shader Effect';
	let name = baseName;
	for (let suffix = 1; definitions.some(definition => definition.name === name); suffix++) name = `${baseName} ${suffix}`;
	if (source != null) {
		const copy = deepClone(source);
		const definition = copy.definition;
		const parameterIds = new Map(Object.keys(definition.paramDefs).map(id => [id, genId()]));
		const outputIds = new Map(Object.keys(definition.outputDefs).map(id => [id, genId()]));

		function remapLayoutItem(item: EffectParameterLayoutItem): EffectParameterLayoutItem {
			return typeof item === 'string' ? parameterIds.get(item)! : { ...item, children: item.children.map(remapLayoutItem) };
		}

		return { ...copy, id: genId(), name, definition: { ...definition,
			...(definition.ui == null ? {} : { ui: { ...definition.ui, parameterLayout: definition.ui.parameterLayout.map(remapLayoutItem) } }),
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
