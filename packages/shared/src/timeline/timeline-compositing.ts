import type { ParameterDefinition } from '../parameter.ts';

export const timelineCompositingParamDefs = {
	blendMode: {
		dataType: { kind: 'blendMode' },
		ui: { label: 'Blend mode', control: {} },
		defaultValue: { inputSource: 'literal', value: 'normal' },
	},
	opacity: {
		dataType: { kind: 'scalar' },
		ui: { label: 'Opacity', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
		defaultValue: { inputSource: 'literal', value: 1 }, canNode: false,
	},
	translation: {
		dataType: { kind: 'vector' },
		ui: { label: 'Position', control: { controlType: 'xy', step: 0.01 } },
		defaultValue: { inputSource: 'literal', value: [0, 0] }, canNode: false,
	},
	scale: {
		dataType: { kind: 'vector' },
		ui: { label: 'Scale', control: { controlType: 'xy', step: 0.01 } },
		defaultValue: { inputSource: 'literal', value: [1, 1] }, canNode: false,
	},
	rotation: {
		dataType: { kind: 'scalar' },
		ui: { label: 'Rotation', control: { controlType: 'angle' } },
		defaultValue: { inputSource: 'literal', value: 0 }, canNode: false,
	},
} as const satisfies Record<string, ParameterDefinition>;
