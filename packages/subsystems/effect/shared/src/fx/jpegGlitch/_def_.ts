import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'jpegGlitch',
	displayName: 'JPEG Glitch',
	description: {
		'ja-JP': 'JPEGのDCT係数の破損、色の誤差の伝播、ブロックのずれと再同期を再現します。ブロックの大きさは出力解像度によらず一定です。',
		'en-US': 'Simulates corrupted JPEG DCT coefficients, propagating color errors, displaced blocks, and restart synchronization. Block size is independent of output resolution.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['glitch', 'pixel', 'color', 'stylized'],
	paramDefs: {
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		blockSize: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Block Size (% of Short Side)',
				control: {
					controlType: 'range',
					min: 0.5,
					max: 10,
					step: 0.1,
				},
			},
			defaultValue: { inputSource: 'literal', value: 2 },
		},
		blockOrigin: {
			dataType: { kind: 'enum', options: ['topLeft', 'center'] },
			ui: { label: 'Block Origin', control: { labels: { topLeft: 'Top Left', center: 'Center' } } },
			defaultValue: { inputSource: 'literal', value: 'center' },
		},
		preserveDetails: { dataType: { kind: 'bool' }, ui: { label: 'Preserve Input Detail', control: {} }, defaultValue: { inputSource: 'literal', value: true } },
		inverseTransform: {
			dataType: { kind: 'enum', options: ['dct', 'hadamard'] },
			ui: { label: 'Inverse Transform', control: { labels: { dct: 'DCT (JPEG)', hadamard: 'Hadamard' } } },
			defaultValue: { inputSource: 'literal', value: 'dct' },
		},
		quantization: { dataType: { kind: 'bool' }, ui: { label: 'Quantization', control: {} }, defaultValue: { inputSource: 'literal', value: true } },
		quality: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'JPEG Quality',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.001,
				},
			},
			defaultValue: { inputSource: 'literal', value: 0.6 },
		},
		chromaSubsampling: {
			dataType: { kind: 'enum', options: ['444', '420'] },
			ui: { label: 'Chroma Subsampling', control: { labels: { '444': '4:4:4 (Off)', '420': '4:2:0' } } },
			defaultValue: { inputSource: 'literal', value: '420' },
		},
		seed: { dataType: { kind: 'scalar' }, ui: { label: 'Seed', control: { controlType: 'seed' } }, defaultValue: { inputSource: 'literal', value: 0 } },
		dcCorruption: { dataType: { kind: 'bool' }, ui: { label: 'DC Corruption', control: {} }, defaultValue: { inputSource: 'literal', value: true } },
		dcProbability: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'DC Corruption Probability',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.001,
				},
			},
			defaultValue: { inputSource: 'literal', value: 0.02 },
		},
		dcLuminance: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'DC Luminance Error',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.01,
				},
			},
			defaultValue: { inputSource: 'literal', value: 0.15 },
		},
		dcChroma: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'DC Chroma Error',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.01,
				},
			},
			defaultValue: { inputSource: 'literal', value: 0.3 },
		},
		dcPropagation: { dataType: { kind: 'bool' }, ui: { label: 'DC Error Propagation', control: {} }, defaultValue: { inputSource: 'literal', value: true } },
		dcRetention: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'DC Error Retention',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.001,
				},
			},
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		acCorruption: { dataType: { kind: 'bool' }, ui: { label: 'AC Corruption', control: {} }, defaultValue: { inputSource: 'literal', value: true } },
		acProbability: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'AC Block Corruption Probability',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.001,
				},
			},
			defaultValue: { inputSource: 'literal', value: 0.08 },
		},
		acCoefficientProbability: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'AC Coefficient Corruption Probability',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.01,
				},
			},
			defaultValue: { inputSource: 'literal', value: 0.15 },
		},
		acMode: {
			dataType: { kind: 'enum', options: ['mixed', 'drop', 'invert', 'amplify', 'shift'] },
			ui: {
				label: 'AC Corruption Mode',
				control: {
					labels: {
						mixed: 'Mixed',
						drop: 'Drop',
						invert: 'Invert Sign',
						amplify: 'Amplify',
						shift: 'Shift Frequency',
					},
				},
			},
			defaultValue: { inputSource: 'literal', value: 'mixed' },
		},
		acStrength: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'AC Corruption Strength',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.01,
				},
			},
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		acMinFrequency: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'AC Minimum Zigzag Index',
				control: {
					controlType: 'range',
					min: 1,
					max: 63,
					step: 1,
				},
			},
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		acMaxFrequency: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'AC Maximum Zigzag Index',
				control: {
					controlType: 'range',
					min: 1,
					max: 63,
					step: 1,
				},
			},
			defaultValue: { inputSource: 'literal', value: 63 },
		},
		acFrequencyShift: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'AC Frequency Shift',
				control: {
					controlType: 'range',
					min: 0,
					max: 62,
					step: 1,
				},
			},
			defaultValue: { inputSource: 'literal', value: 5 },
		},
		blockShift: { dataType: { kind: 'bool' }, ui: { label: 'Block Displacement', control: {} }, defaultValue: { inputSource: 'literal', value: true } },
		shiftProbability: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Block Displacement Probability',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.001,
				},
			},
			defaultValue: { inputSource: 'literal', value: 0.01 },
		},
		shiftAmount: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Maximum Displacement Step (MCUs)',
				control: {
					controlType: 'range',
					min: 0,
					max: 64,
					step: 1,
				},
			},
			defaultValue: { inputSource: 'literal', value: 4 },
		},
		resynchronization: { dataType: { kind: 'bool' }, ui: { label: 'Restart Synchronization', control: {} }, defaultValue: { inputSource: 'literal', value: true } },
		restartInterval: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Restart Interval (MCUs)',
				control: {
					controlType: 'range',
					min: 1,
					max: 512,
					step: 1,
				},
			},
			defaultValue: { inputSource: 'literal', value: 64 },
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameter: 'input',
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
