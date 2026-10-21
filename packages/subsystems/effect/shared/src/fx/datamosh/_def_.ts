import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'datamosh',
	displayName: 'Datamoshing',
	description: {
		'ja-JP': 'ブロックごとの動きで過去の映像を変形し、Datamoshingのような色の引きずりや映像の残留を作ります。動き用の映像を別に指定できます。',
		'en-US': 'Warps accumulated frames with block motion to create datamoshing trails and persistent imagery. Supports a separate motion source.',
	},
	kind: 'modify',
	dependsOnRenderHistory: true,
	tags: ['glitch', 'temporal', 'distortion', 'pixel'],
	paramDefs: {
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		motionSource: {
			dataType: { kind: 'enum', options: ['input', 'separate'] },
			ui: { label: 'Motion Source', control: { labels: { input: 'Input', separate: 'Separate Motion Input' } } },
			defaultValue: { inputSource: 'literal', value: 'input' },
		},
		motionInput: {
			dataType: { kind: 'color' },
			ui: { label: 'Motion Input', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		blockSize: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Block Size (% of Short Side)',
				control: {
					controlType: 'range',
					min: 1,
					max: 20,
					step: 0.1,
				},
			},
			defaultValue: { inputSource: 'literal', value: 4 },
		},
		blockOrigin: {
			dataType: { kind: 'enum', options: ['topLeft', 'center'] },
			ui: { label: 'Block Origin', control: { labels: { topLeft: 'Top Left', center: 'Image Center' } } },
			defaultValue: { inputSource: 'literal', value: 'center' },
		},
		searchRange: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Motion Search Range (% of Short Side)',
				control: {
					controlType: 'range',
					min: 0,
					max: 25,
					step: 0.1,
				},
			},
			defaultValue: { inputSource: 'literal', value: 8 },
		},
		motionStrength: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Motion Strength',
				control: {
					controlType: 'range',
					min: -4,
					max: 4,
					step: 0.01,
				},
			},
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		motionThreshold: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Motion Change Threshold',
				control: {
					controlType: 'range',
					min: 0,
					max: 0.1,
					step: 0.001,
				},
			},
			defaultValue: { inputSource: 'literal', value: 0.001 },
		},
		matchThreshold: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Maximum Motion Match Error',
				control: {
					controlType: 'range',
					min: 0.001,
					max: 0.5,
					step: 0.001,
				},
			},
			defaultValue: { inputSource: 'literal', value: 0.15 },
		},
		motionSmoothing: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Motion Smoothing Half-Life (ms)',
				control: {
					controlType: 'range',
					min: 0,
					max: 2000,
					step: 1,
				},
			},
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		blockyMotion: { dataType: { kind: 'bool' }, ui: { label: 'Blocky Motion', control: {} }, defaultValue: { inputSource: 'literal', value: true } },
		recoveryRate: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Input Recovery Rate (1/s)',
				control: {
					controlType: 'range',
					min: 0,
					max: 5,
					step: 0.01,
				},
			},
			defaultValue: { inputSource: 'literal', value: 0.15 },
		},
		recoveryMask: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Input Recovery Mask',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.01,
				},
			},
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		blockRefreshRate: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Block Refresh Rate (1/s)',
				control: {
					controlType: 'range',
					min: 0,
					max: 5,
					step: 0.01,
				},
			},
			defaultValue: { inputSource: 'literal', value: 0.1 },
		},
		resetInterval: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Reset Interval (s, 0 = Off)',
				control: {
					controlType: 'range',
					min: 0,
					max: 30,
					step: 0.1,
				},
			},
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		reset: { dataType: { kind: 'bool' }, ui: { label: 'Reset', control: {} }, defaultValue: { inputSource: 'literal', value: false } },
		historyWrap: { dataType: { kind: 'wrapMode' }, ui: { label: 'History Wrap Mode', control: {} }, defaultValue: { inputSource: 'literal', value: 'clamp' } },
		seed: { dataType: { kind: 'scalar' }, ui: { label: 'Seed', control: { controlType: 'seed' } }, defaultValue: { inputSource: 'literal', value: 0 } },
	},
	primaryInputParameter: 'input',
	resolutionInputParameter: 'input',
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
