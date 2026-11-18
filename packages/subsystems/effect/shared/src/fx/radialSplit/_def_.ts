import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'radialSplit',
	displayName: 'Radial Split',
	summary: {
		'ja-JP': '複数の画像や色を、一定幅の隙間を持つ均等な扇形の領域へ配置します。',
		'en-US': 'Arranges images or colors in equal angular sectors with constant-width gaps.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['composite', 'transform', 'utility'],
	paramDefs: {
		inputs: {
			dataType: { kind: 'array', elementType: { kind: 'color' } },
			ui: { label: 'Inputs', control: { element: {} } },
			defaultValue: {
				inputSource: 'literal',
				value: [
					{ id: 'first', binding: { inputSource: 'literal', value: [0, 0, 0, 0] } },
					{ id: 'second', binding: { inputSource: 'literal', value: [0, 0, 0, 0] } },
				],
			},
			element: { canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		},
		center: {
			dataType: { kind: 'vector' },
			ui: { label: 'Center', control: { controlType: 'xy', min: -0.5, max: 0.5, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: [0, 0] },
		},
		startAngle: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Start Angle', control: { controlType: 'angle' } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		direction: {
			dataType: { kind: 'enum', options: ['clockwise', 'counterclockwise'] },
			ui: { label: 'Direction', control: { labels: { clockwise: 'Clockwise', counterclockwise: 'Counterclockwise' } } },
			defaultValue: { inputSource: 'literal', value: 'clockwise' },
		},
		gap: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Gap', control: { controlType: 'range', min: 0, max: 0.5, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		sizeReference: {
			dataType: { kind: 'sizeReference' },
			ui: { label: 'Size Reference', isAdvanced: true, control: {} },
			defaultValue: { inputSource: 'literal', value: 'longSide' },
		},
	},
	primaryInputParameter: null,
	resolutionInputParameters: ['inputs'],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
