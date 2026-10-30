import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'composeVectorPolar',
	displayName: 'Compose Vector (Polar)',
	description: {
		'ja-JP': '角度と長さから2次元ベクトルを作ります。上向きが0、時計回りに1で1周です。負の長さは0として扱います。',
		'en-US': 'Creates a two-dimensional vector from angle and length. Zero points up; one turn is clockwise. Negative lengths are treated as zero.',
	},
	kind: 'generate',
	dependsOnRenderHistory: false,
	tags: ['math', 'utility', 'convert'],
	paramDefs: {
		angle: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Angle', control: { controlType: 'angle' } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		length: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Length', control: { controlType: 'number', min: 0, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 1 },
		},
	},
	primaryInputParameter: null,
	resolutionInputParameters: ['angle', 'length'],
	outputDefs: { output: { dataType: { kind: 'vector' } } },
	primaryOutput: 'output',
});
