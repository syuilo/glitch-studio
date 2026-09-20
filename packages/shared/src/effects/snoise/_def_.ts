import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'snoise',
	displayName: 'snoise',
	tags: [],
	paramDefs: {
		scale: { dataType: 'vector', ui: { control: 'vector', min: 0, max: 16, step: 0.01 }, label: 'Scale', canNode: true, default: () => ({ inputSource: 'literal', value: [1, 1] }) },
		offset: { dataType: 'vector', ui: { control: 'vector', min: 0, max: 16, step: 0.01 }, label: 'Offset', default: () => ({ inputSource: 'literal', value: [0, 0] }) },
		outputMin: { dataType: 'scalar', ui: { control: 'number', step: 0.01 }, label: 'Output Min', canNode: true, default: () => ({ inputSource: 'literal', value: -1 }) },
		outputMax: { dataType: 'scalar', ui: { control: 'number', step: 0.01 }, label: 'Output Max', canNode: true, default: () => ({ inputSource: 'literal', value: 1 }) },
		// canNodeでは環境によってTimeが16bitテクスチャに丸められ、経過時間とともに
		// 値の刻みが粗くなって動きがカクつくため、32bitのuniformで渡す。
		time: { dataType: 'scalar', ui: { control: 'range', min: 0, max: 100, step: 0.01 }, label: 'Time', canNode: false, default: () => ({ inputSource: 'envVariable', variable: 'TIME' }) },
		seed: { dataType: 'scalar', ui: { control: 'seed' }, label: 'Seed', canNode: false, default: () => ({ inputSource: 'literal', value: 0 }) },
	},
	outputs: {
		output: { primary: true, dataType: 'scalar' },
	},
});
