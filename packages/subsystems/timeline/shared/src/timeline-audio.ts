import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';

export const timelineAudioParamDefs = {
	volume: {
		dataType: { kind: 'scalar' },
		ui: { label: 'Volume', control: { controlType: 'range', min: 0, max: 2, step: 0.01 } },
		defaultValue: { inputSource: 'literal', value: 1 },
		canNode: false,
	},
} as const satisfies Record<string, ParameterDefinition>;
