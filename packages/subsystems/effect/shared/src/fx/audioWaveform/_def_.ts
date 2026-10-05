import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'audioWaveform',
	displayName: 'Audio Waveform',
	description: {
		'ja-JP': '入力音声を波形で表示します。',
		'en-US': 'Visualizes input audio as a waveform.',
	},
	kind: 'generate',
	// 入力音声の履歴から毎回計算し、過去の描画結果には依存しない。
	dependsOnRenderHistory: false,
	tags: ['audio', 'analysis'],
	paramDefs: {
		audio: { dataType: { kind: 'audioSource' }, ui: { label: 'Audio', control: {} }, defaultValue: { inputSource: 'literal', value: null } },
		channel: {
			dataType: { kind: 'enum', options: ['left', 'right', 'stereo'] },
			ui: { label: 'Channel', control: { labels: { 'left': 'L', 'right': 'R', 'stereo': 'Stereo' } } },
			defaultValue: { inputSource: 'literal', value: 'stereo' },
		},
		duration: { dataType: { kind: 'scalar' }, ui: { label: 'Time span (seconds)', control: { controlType: 'range', min: 0.005, max: 1, step: 0.005 } }, defaultValue: { inputSource: 'literal', value: 0.05 } },
		amplitude: { dataType: { kind: 'scalar' }, ui: { label: 'Amplitude', control: { controlType: 'range', min: 0, max: 10, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 1 } },
		lineWidth: { dataType: { kind: 'scalar' }, ui: { label: 'Line width', control: { controlType: 'range', min: 0.001, max: 0.05, step: 0.001 } }, defaultValue: { inputSource: 'literal', value: 0.003 } },
		color: { dataType: { kind: 'color' }, ui: { label: 'Color', control: {} }, defaultValue: { inputSource: 'literal', value: [1, 1, 1, 1] } },
	},
	primaryInputParameter: null,
	primaryAudioInputParameter: 'audio',
	resolutionInputParameter: null,
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
