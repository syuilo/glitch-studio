import { defineEffect } from '../../effect-definition.ts';
import spectrum from '../../effect-definitions/audioSpectrum.ts';

const { color, rightColor, ...analysisParams } = spectrum.paramDefs;

export default defineEffect({
	id: 'audioSpectrogram',
	displayName: 'Audio Spectrogram',
	tags: [],
	paramDefs: {
		...analysisParams,
		channel: { ...analysisParams.channel, default: () => ({ type: 'literal', value: 'mix' }) },
		smoothing: { ...analysisParams.smoothing, default: () => ({ type: 'literal', value: 0 }) },
		duration: { type: 'range', label: 'Time span (seconds)', min: 0.5, max: 60, step: 0.5, default: () => ({ type: 'literal', value: 10 }) },
		orientation: { type: 'enum', label: 'Time axis', options: [
			{ label: 'Horizontal', value: 'horizontal' }, { label: 'Vertical', value: 'vertical' },
		], default: () => ({ type: 'literal', value: 'horizontal' }) },
		direction: { type: 'enum', label: 'Flow direction', options: [
			{ label: 'Right to left / Top to bottom', value: 'forward' },
			{ label: 'Left to right / Bottom to top', value: 'reverse' },
		], default: () => ({ type: 'literal', value: 'forward' }) },
		flipFrequency: { type: 'bool', label: 'Reverse frequency axis', default: () => ({ type: 'literal', value: false }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
