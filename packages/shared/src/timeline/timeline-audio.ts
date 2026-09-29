import type { ParameterDefinition } from '../parameter.ts';

export const timelineAudioParamDefs = {
	volume: {
		dataType: { kind: 'scalar' },
		ui: { label: 'Volume', control: { controlType: 'range', min: 0, max: 2, step: 0.01 } },
		defaultValue: { inputSource: 'literal', value: 1 },
		canNode: false,
	},
} as const satisfies Record<string, ParameterDefinition>;

// モジュールの環境は継承せず、音声レイヤーのローカル時刻を明示する。
export const AUDIO_LAYER_VAR_DEFS = ['TIME', 'TIME_MS', 'END_TIME', 'END_TIME_MS', 'PROGRESS', 'IS_EXPORT'] as const;
