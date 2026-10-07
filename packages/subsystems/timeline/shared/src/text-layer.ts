import { textParamDefs } from './text.ts';
import { validateTimelineParameterTree } from './parameter-binding.ts';
import type { TextParameterValues } from './text.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';

export function validateTimelineText(values: TextParameterValues): void {
	const definitions: Record<string, ParameterDefinition> = textParamDefs;
	for (const [key, binding] of Object.entries(values)) {
		if (!Object.hasOwn(definitions, key)) throw new Error('Unknown text parameter: ' + key);
		validateTimelineParameterTree(definitions[key], binding);
	}
}
