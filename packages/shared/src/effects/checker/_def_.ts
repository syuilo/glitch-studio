import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'checker',
	displayName: 'Checker',
	tags: ['pattern'],
	paramDefs: {
		background: { dataType: 'color', ui: { label: 'Background', control: 'color' }, canNode: true, primary: true, defaultValue: { inputSource: 'node', nodeId: null, outputPort: null } },
		angle: { dataType: 'scalar', ui: { label: 'Angle', control: 'angle' }, defaultValue: { inputSource: 'literal', value: 0 } },
		size: { dataType: 'scalar', ui: { label: 'Size', control: 'range', min: 0, max: 1, step: 0.001 }, defaultValue: { inputSource: 'literal', value: 1 / 3 } },
		color: { dataType: 'color', ui: { label: 'Color', control: 'color' }, defaultValue: { inputSource: 'literal', value: [1, 1, 1, 0.5] } },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
