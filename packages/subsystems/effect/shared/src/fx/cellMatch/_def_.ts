import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'cellMatch',
	displayName: 'Cell Match',
	description: {
		'ja-JP': '主入力をセルに分割し、副入力の平均色や明暗に近づくように画像片を配置します。セルの再利用も選択できます。',
		'en-US': 'Places image fragments from the input to resemble the reference, with optional cell reuse.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['glitch', 'pattern', 'stylized'],
	paramDefs: {
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		reference: {
			dataType: { kind: 'color' },
			ui: { label: 'Reference', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		frequency: {
			dataType: { kind: 'vector' },
			ui: { label: 'Frequency', control: { controlType: 'dimension', min: 0.01, max: 1000, logarithmic: true } },
			defaultValue: { inputSource: 'literal', value: [10, 10] },
		},
		// Phaseはセルの周期を単位とし、格子座標の正のYは上方向。
		phase: {
			dataType: { kind: 'vector' },
			ui: { label: 'Phase', control: { controlType: 'vector', min: -1, max: 1, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: [0, 0] },
		},
		sizeReference: { dataType: { kind: 'sizeReference' }, ui: { label: 'Size Reference', isAdvanced: true, control: {} }, defaultValue: { inputSource: 'literal', value: 'longSide' } },
		placementMode: {
			dataType: { kind: 'enum', options: ['oneToOne', 'reuse'] },
			ui: { label: 'Placement Mode', control: { labels: { oneToOne: 'One-to-One', reuse: 'Allow Reuse' } } },
			defaultValue: { inputSource: 'literal', value: 'oneToOne' },
		},
		matchBy: {
			dataType: { kind: 'enum', options: ['color', 'luminance'] },
			ui: { label: 'Match By', control: { labels: { color: 'Average Color', luminance: 'Average Luminance' } } },
			defaultValue: { inputSource: 'literal', value: 'color' },
		},
		positionBias: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Position Bias', control: { controlType: 'range', min: 0, max: 10, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		samplesPerCell: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Samples Per Cell', control: { controlType: 'range', min: 1, max: 256, step: 1 } },
			defaultValue: { inputSource: 'literal', value: 16 },
		},
		iterations: {
			dataType: { kind: 'scalar' },
			ui: { label: 'One-to-One Iterations', control: { controlType: 'range', min: 0, max: 1024, step: 1 } },
			defaultValue: { inputSource: 'literal', value: 128 },
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
