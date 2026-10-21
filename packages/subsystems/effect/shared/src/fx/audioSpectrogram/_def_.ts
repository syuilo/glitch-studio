import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'audioSpectrogram',
	displayName: 'Audio Spectrogram',
	description: {
		'ja-JP': '入力音声の周波数成分と時間変化をスペクトログラムで表示します。表示は描画履歴に依存します。',
		'en-US': 'Visualizes input audio as a spectrogram showing frequency content over time. The display depends on render history.',
	},
	kind: 'generate',
	// 入力音声の履歴に加え、過去の描画で解析したスペクトラムを内部に蓄積する。
	dependsOnRenderHistory: true,
	tags: ['audio', 'analysis', 'temporal'],
	paramDefs: {
		audio: {
			dataType: { kind: 'audioSource' },
			ui: { label: 'Audio', control: {} },
			canNode: false,
			defaultValue: { inputSource: 'literal', value: null },
		},
		channel: {
			dataType: { kind: 'enum', options: ['left', 'right', 'mix', 'stereo'] },
			ui: {
				label: 'Channel',
				control: {
					labels: {
						'left': 'Left',
						'right': 'Right',
						'mix': 'Mix (L + R)',
						'stereo': 'Stereo',
					},
				},
			},
			defaultValue: { inputSource: 'literal', value: 'mix' },
		},
		fftSize: {
			dataType: { kind: 'enum', options: ['256', '512', '1024', '2048', '4096', '8192', '16384', '32768'] },
			ui: {
				label: 'FFT Size',
				control: {
					labels: {
						'256': '256',
						'512': '512',
						'1024': '1024',
						'2048': '2048',
						'4096': '4096',
						'8192': '8192',
						'16384': '16384',
						'32768': '32768',
					},
				},
			},
			defaultValue: { inputSource: 'literal', value: '2048' },
		},
		window: {
			dataType: { kind: 'enum', options: ['hann', 'hamming', 'blackman', 'rectangular'] },
			ui: {
				label: 'Window',
				control: {
					labels: {
						'hann': 'Hann',
						'hamming': 'Hamming',
						'blackman': 'Blackman',
						'rectangular': 'Rectangular',
					},
				},
			},
			defaultValue: { inputSource: 'literal', value: 'hann' },
		},
		smoothing: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Smoothing (Seconds)',
				control: {
					controlType: 'range',
					min: 0,
					max: 2,
					step: 0.01,
				},
			},
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		minFrequency: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Minimum Frequency (Hz)',
				control: {
					controlType: 'number',
					min: 0,
					max: 96000,
					step: 1,
				},
			},
			defaultValue: { inputSource: 'literal', value: 20 },
		},
		maxFrequency: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Maximum Frequency (Hz)',
				control: {
					controlType: 'number',
					min: 1,
					max: 96000,
					step: 1,
				},
			},
			defaultValue: { inputSource: 'literal', value: 20000 },
		},
		logarithmic: { dataType: { kind: 'bool' }, ui: { label: 'Logarithmic Frequency', control: {} }, defaultValue: { inputSource: 'literal', value: false } },
		minDb: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Minimum dB',
				control: {
					controlType: 'range',
					min: -120,
					max: -1,
					step: 1,
				},
			},
			defaultValue: { inputSource: 'literal', value: -80 },
		},
		maxDb: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Maximum dB',
				control: {
					controlType: 'range',
					min: -60,
					max: 20,
					step: 1,
				},
			},
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		duration: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Time Span (Seconds)',
				control: {
					controlType: 'range',
					min: 0.5,
					max: 60,
					step: 0.5,
				},
			},
			defaultValue: { inputSource: 'literal', value: 10 },
		},
		orientation: {
			dataType: { kind: 'enum', options: ['horizontal', 'vertical'] },
			ui: { label: 'Time Axis', control: { labels: { 'horizontal': 'Horizontal', 'vertical': 'Vertical' } } },
			defaultValue: { inputSource: 'literal', value: 'horizontal' },
		},
		direction: {
			dataType: { kind: 'enum', options: ['forward', 'reverse'] },
			ui: { label: 'Flow Direction', control: { labels: { 'forward': 'Right to Left / Top to Bottom', 'reverse': 'Left to Right / Bottom to Top' } } },
			defaultValue: { inputSource: 'literal', value: 'forward' },
		},
		flipFrequency: { dataType: { kind: 'bool' }, ui: { label: 'Reverse Frequency Axis', control: {} }, defaultValue: { inputSource: 'literal', value: false } },
	},
	primaryInputParameter: null,
	primaryAudioInputParameter: 'audio',
	resolutionInputParameter: null,
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
