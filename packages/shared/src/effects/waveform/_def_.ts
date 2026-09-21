import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'waveform',
	displayName: 'Waveform',
	tags: [],
	paramDefs: {
		input: { dataType: 'color', ui: { label: 'Input', control: 'color' }, canNode: true, primary: true, defaultValue: { inputSource: 'node', nodeId: null, outputPort: null } },
		resolution: { dataType: 'enum', ui: { label: 'Resolution', control: 'enum' }, options: [
			{ label: '1/1', value: 1 },
			{ label: '1/2', value: 2 },
			{ label: '1/4', value: 4 },
			{ label: '1/8', value: 8 },
			{ label: '1/16', value: 16 },
		], defaultValue: { inputSource: 'literal', value: 1 } },
		direction: { dataType: 'enum', ui: { label: 'Direction', control: 'enum' }, options: [
			{ label: 'Horizontal', value: 'horizontal' },
			{ label: 'Vertical', value: 'vertical' },
		], defaultValue: { inputSource: 'literal', value: 'horizontal' } },
		mode: { dataType: 'enum', ui: { label: 'Mode', control: 'enum' }, options: [
			{ label: 'RGB', value: 'rgb' },
			{ label: 'Luminance', value: 'luminance' },
		], defaultValue: { inputSource: 'literal', value: 'rgb' } },
		intensity: { dataType: 'scalar', ui: { label: 'Intensity', control: 'range', min: 0, max: 10, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 1 } },
		showGrid: { dataType: 'bool', ui: { label: 'Grid', control: 'bool' }, defaultValue: { inputSource: 'literal', value: false } },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
