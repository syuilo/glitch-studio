import type { NativeEffectDefinition } from '../native-effect-definition.ts';

const definition = {
	id: 'solidColor' as const,
	displayName: 'Solid Color',
	kind: 'generate',
	summary: { 'ja-JP': '指定した色で画面を塗りつぶします。', 'en-US': 'Fills the frame with a single color.' },
	paramDefs: {
		color: {
			dataType: { kind: 'color' },
			ui: { label: 'Color', control: { controlType: 'color' } },
			defaultValue: { inputSource: 'literal', value: [1, 1, 1, 1] },
		},
	},
	outputDefs: { color: { dataType: { kind: 'color' } } },
	primaryInputId: null,
	primaryAudioInputId: null,
	primaryOutputId: 'color',
} satisfies NativeEffectDefinition;

export default definition;
