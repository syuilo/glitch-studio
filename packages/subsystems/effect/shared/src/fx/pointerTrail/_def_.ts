import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'pointerTrail',
	displayName: 'pointerTrail',
	description: {
		'ja-JP': 'ポインターの動きを、時間とともに減衰するベクトル場として出力します。',
		'en-US': 'Outputs pointer motion as a vector field that fades over time.',
	},
	kind: 'generate',
	dependsOnRenderHistory: true,
	tags: ['temporal', 'utility'],
	paramDefs: {
		strength: { dataType: { kind: 'scalar' }, ui: { label: 'Strength', control: { controlType: 'range', min: 0, max: 2, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.3 } },
		radius: { dataType: { kind: 'scalar' }, ui: { label: 'Radius', control: { controlType: 'range', min: 0, max: 2, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.3 } },
		halfLife: { dataType: { kind: 'scalar' }, ui: { label: 'Half-life (ms)', control: { controlType: 'range', min: 1, max: 5000, step: 1 } }, defaultValue: { inputSource: 'literal', value: 300 } },
	},
	primaryInputParameter: null,
	resolutionInputParameter: null,
	outputDefs: {
		output: { dataType: { kind: 'vector' } },
	},
	primaryOutput: 'output',
});
