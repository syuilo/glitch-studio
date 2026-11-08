import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'phaseScramble',
	displayName: 'Phase Scramble',
	description: {
		'ja-JP': '画像の周波数成分の位相を乱し、輪郭や構造がほどけるような変化を加えます。画面全体・ブロック単位の処理に対応します。',
		'en-US': 'Scrambles Fourier phases to dissolve image structure, globally or in overlapping blocks.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['glitch', 'stylized', 'experimental'],
	paramDefs: {
		input: { dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		processing: {
			dataType: { kind: 'enum', options: ['global', 'blocks'] },
			ui: { label: 'Processing', control: { labels: { global: 'Global', blocks: 'Blocks' } } },
			defaultValue: { inputSource: 'literal', value: 'global' },
		},
		amount: { dataType: { kind: 'scalar' }, ui: { label: 'Amount', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.5 } },
		minFrequency: { dataType: { kind: 'scalar' }, ui: { label: 'Minimum Frequency (Cycles per Reference)', control: { controlType: 'range', min: 0, max: 256, step: 0.1 } }, defaultValue: { inputSource: 'literal', value: 2 } },
		maxFrequency: { dataType: { kind: 'scalar' }, ui: { label: 'Maximum Frequency (Cycles per Reference)', control: { controlType: 'range', min: 0, max: 256, step: 0.1 } }, defaultValue: { inputSource: 'literal', value: 64 } },
		softness: { dataType: { kind: 'scalar' }, ui: { label: 'Frequency Softness (Cycles per Reference)', control: { controlType: 'range', min: 0, max: 32, step: 0.1 } }, defaultValue: { inputSource: 'literal', value: 2 } },
		seed: { dataType: { kind: 'scalar' }, ui: { label: 'Seed', control: { controlType: 'seed' } }, defaultValue: { inputSource: 'literal', value: 0 } },
		evolution: { dataType: { kind: 'scalar' }, ui: { label: 'Evolution', control: { controlType: 'range', min: -10, max: 10, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0 } },
		channelMode: {
			dataType: { kind: 'enum', options: ['linked', 'independent'] },
			ui: { label: 'Channel Mode', control: { labels: { linked: 'RGB Linked', independent: 'RGB Independent' } } },
			defaultValue: { inputSource: 'literal', value: 'linked' },
		},
		boundary: {
			dataType: { kind: 'enum', options: ['repeat', 'mirror'] },
			ui: { label: 'Boundary', control: { labels: { repeat: 'Repeat', mirror: 'Mirror' } } },
			defaultValue: { inputSource: 'literal', value: 'mirror' },
		},
		analysisResolution: {
			dataType: { kind: 'enum', options: ['16', '32', '64', '128', '256', '512', '1024'] },
			ui: { label: 'Global Analysis Resolution', control: { labels: { '16': '16', '32': '32', '64': '64', '128': '128', '256': '256', '512': '512', '1024': '1024' } } },
			defaultValue: { inputSource: 'literal', value: '256' },
		},
		blockSize: { dataType: { kind: 'scalar' }, ui: { label: 'Block Size (% of Reference)', control: { controlType: 'range', min: 2, max: 100, step: 0.1 } }, defaultValue: { inputSource: 'literal', value: 25 } },
		blockResolution: {
			dataType: { kind: 'enum', options: ['16', '32', '64', '128'] },
			ui: { label: 'Block Analysis Resolution', control: { labels: { '16': '16', '32': '32', '64': '64', '128': '128' } } },
			defaultValue: { inputSource: 'literal', value: '32' },
		},
		sizeReference: { dataType: { kind: 'sizeReference' }, ui: { label: 'Size Reference', isAdvanced: true, control: {} }, defaultValue: { inputSource: 'literal', value: 'longSide' } },
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
