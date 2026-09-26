import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'snoise',
	displayName: 'snoise',
	tags: [],
	primaryInputParameter: null,
	paramDefs: {
		scale: { dataType: { kind: 'vector' }, ui: { label: 'Scale', control: { controlType: 'vector', min: 0, max: 16, step: 0.01 } }, canNode: true, defaultValue: { inputSource: 'literal', value: [1, 1] } },
		offset: { dataType: { kind: 'vector' }, ui: { label: 'Offset', control: { controlType: 'vector', min: 0, max: 16, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: [0, 0] } },
		outputMin: { dataType: { kind: 'scalar' }, ui: { label: 'Output Min', control: { controlType: 'number', step: 0.01 } }, canNode: true, defaultValue: { inputSource: 'literal', value: -1 } },
		outputMax: { dataType: { kind: 'scalar' }, ui: { label: 'Output Max', control: { controlType: 'number', step: 0.01 } }, canNode: true, defaultValue: { inputSource: 'literal', value: 1 } },
		// canNodeでは環境によってTimeが16bitテクスチャに丸められ、経過時間とともに
		// 値の刻みが粗くなって動きがカクつくため、32bitのuniformで渡す。
		time: { dataType: { kind: 'scalar' }, ui: { label: 'Time', control: { controlType: 'number', step: 0.01 } }, canNode: false, defaultValue: { inputSource: 'literal', value: 0 } },
		seed: { dataType: { kind: 'scalar' }, ui: { label: 'Seed', control: { controlType: 'seed' } }, canNode: false, defaultValue: { inputSource: 'literal', value: 0 } },
	},
	outputDefs: {
		output: { primary: true, dataType: { kind: 'scalar' } },
	},
});
