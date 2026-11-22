import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Phase Transfer',
	summary: {
		'ja-JP': '主入力の周波数振幅を保ちながら副入力の位相を移植し、画像の構造を組み合わせます。画面全体・ブロック単位の処理に対応します。',
		'en-US': 'Transfers reference phases while retaining input spectral magnitudes, globally or in overlapping blocks.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['composite', 'glitch'],
	paramDefs: {
		input: { dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: [0, 0, 0, 0] },
		reference: { dataType: { kind: 'color' }, ui: { label: 'Reference', control: {} }, canNode: true, defaultValue: [0, 0, 0, 0] },
		processing: {
			dataType: { kind: 'enum', options: ['global', 'blocks'] },
			ui: { label: 'Processing', control: { labels: { global: 'Global', blocks: 'Blocks' } } },
			defaultValue: 'global',
		},
		amount: { dataType: { kind: 'scalar' }, ui: { label: 'Amount', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: 0.5 },
		minFrequency: { dataType: { kind: 'scalar' }, ui: { label: 'Minimum Frequency (Cycles per Reference)', control: { controlType: 'range', min: 0, max: 256, step: 0.1 } }, defaultValue: 2 },
		maxFrequency: { dataType: { kind: 'scalar' }, ui: { label: 'Maximum Frequency (Cycles per Reference)', control: { controlType: 'range', min: 0, max: 256, step: 0.1 } }, defaultValue: 64 },
		softness: { dataType: { kind: 'scalar' }, ui: { label: 'Frequency Softness (Cycles per Reference)', control: { controlType: 'range', min: 0, max: 32, step: 0.1 } }, defaultValue: 2 },
		phaseThreshold: { dataType: { kind: 'scalar' }, ui: { label: 'Minimum Phase Amplitude', control: { controlType: 'range', min: 0, max: 0.05, step: 0.00001 } }, defaultValue: 0.00001 },
		channelMode: {
			dataType: { kind: 'enum', options: ['linked', 'independent'] },
			ui: { label: 'Channel Mode', control: { labels: { linked: 'RGB Linked (Luminance Phase)', independent: 'RGB Independent' } } },
			defaultValue: 'linked',
		},
		boundary: {
			dataType: { kind: 'enum', options: ['repeat', 'mirror'] },
			ui: { label: 'Boundary', control: { labels: { repeat: 'Repeat', mirror: 'Mirror' } } },
			defaultValue: 'mirror',
		},
		analysisResolution: {
			dataType: { kind: 'enum', options: ['16', '32', '64', '128', '256', '512', '1024'] },
			ui: { label: 'Global Analysis Resolution', control: { labels: { '16': '16', '32': '32', '64': '64', '128': '128', '256': '256', '512': '512', '1024': '1024' } } },
			defaultValue: '256',
		},
		blockSize: { dataType: { kind: 'scalar' }, ui: { label: 'Block Size (% of Reference)', control: { controlType: 'range', min: 2, max: 100, step: 0.1 } }, defaultValue: 25 },
		blockResolution: {
			dataType: { kind: 'enum', options: ['16', '32', '64', '128'] },
			ui: { label: 'Block Analysis Resolution', control: { labels: { '16': '16', '32': '32', '64': '64', '128': '128' } } },
			defaultValue: '32',
		},
		sizeReference: { dataType: { kind: 'sizeReference' }, ui: { label: 'Size Reference', isAdvanced: true, control: {} }, defaultValue: 'longSide' },
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
