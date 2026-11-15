import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'zoomTransition',
	displayName: 'Zoom Transition',
	description: {
		'ja-JP': '同じ中心へズームインまたはズームアウトしながら、画像Aから画像Bへ切り替えます。',
		'en-US': 'Transitions from image A to image B while zooming in or out around a shared center.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['composite', 'transition', 'transform'],
	paramDefs: {
		inputA: {
			dataType: { kind: 'color' },
			ui: { label: 'A', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		inputB: {
			dataType: { kind: 'color' },
			ui: { label: 'B', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		progress: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Progress', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		center: {
			dataType: { kind: 'vector' },
			ui: { label: 'Center', control: { controlType: 'xy', min: -0.5, max: 0.5, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: [0, 0] },
		},
		zoom: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Zoom Factor', control: { controlType: 'range', min: 1, max: 16, step: 0.01, logarithmic: true } },
			defaultValue: { inputSource: 'literal', value: 2 },
		},
		direction: {
			dataType: { kind: 'enum', options: ['in', 'out'] },
			ui: { label: 'Direction', control: { labels: { in: 'In', out: 'Out' } } },
			defaultValue: { inputSource: 'literal', value: 'in' },
		},
		overlap: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Overlap', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 0.5 },
		},
	},
	primaryInputParameter: 'inputA',
	resolutionInputParameters: ['inputA', 'inputB'],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});

