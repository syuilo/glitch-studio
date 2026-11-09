import { srgbToLinearSrgb } from '@gs/shared/color-space.ts';
import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'streamlines',
	displayName: 'Streamlines',
	description: {
		'ja-JP': 'ベクトル場の流れを線で描き、向きや強さを可視化します。',
		'en-US': 'Draws streamlines to visualize the direction and magnitude of a vector field.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['utility', 'convert'],
	paramDefs: {
		sizeReference: { dataType: { kind: 'sizeReference' }, ui: { label: 'Size Reference', isAdvanced: true, control: {} }, defaultValue: { inputSource: 'literal', value: 'longSide' } },
		vector: { dataType: { kind: 'vector' }, ui: { label: 'Vector', control: { controlType: 'vector' } }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0] } },
		density: { dataType: { kind: 'scalar' }, ui: { label: 'Seed Density', control: { controlType: 'range', min: 1, max: 64, step: 1 } }, defaultValue: { inputSource: 'literal', value: 8 } },
		maximumLength: { dataType: { kind: 'scalar' }, ui: { label: 'Maximum Length', control: { controlType: 'range', min: 0.001, max: 4, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.75 } },
		stepSize: { dataType: { kind: 'scalar' }, ui: { label: 'Step Size', control: { controlType: 'number', min: 0.00001, step: 0.001 } }, defaultValue: { inputSource: 'literal', value: 0.01 } },
		maximumSteps: { dataType: { kind: 'scalar' }, ui: { label: 'Maximum Steps', control: { controlType: 'range', min: 1, max: 2048, step: 1 } }, defaultValue: { inputSource: 'literal', value: 256 } },
		minimumMagnitude: { dataType: { kind: 'scalar' }, ui: { label: 'Minimum Magnitude', control: { controlType: 'number', min: 0, step: 0.000001 } }, defaultValue: { inputSource: 'literal', value: 0.000001 } },
		lineWidth: { dataType: { kind: 'scalar' }, ui: { label: 'Line Width', control: { controlType: 'range', min: 0, max: 0.05, step: 0.0005 } }, defaultValue: { inputSource: 'literal', value: 0.003 } },
		arrowSpacing: { dataType: { kind: 'scalar' }, ui: { label: 'Arrow Spacing', control: { controlType: 'range', min: 0.001, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.15 } },
		arrowSize: { dataType: { kind: 'scalar' }, ui: { label: 'Arrow Size', control: { controlType: 'range', min: 0, max: 0.1, step: 0.001 } }, defaultValue: { inputSource: 'literal', value: 0.025 } },
		maximumMagnitude: { dataType: { kind: 'scalar' }, ui: { label: 'Maximum Magnitude', control: { controlType: 'number', min: 0.000001, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 1 } },
		ramp: {
			dataType: { kind: 'colorRamp' }, ui: { label: 'Ramp', control: {} },
			defaultValue: { inputSource: 'literal', value: { interpolation: 'linear', colorSpace: 'srgb', stops: [
				{ id: 'start', position: 0, color: srgbToLinearSrgb([0.1, 0.6, 1, 1]) },
				{ id: 'end', position: 1, color: srgbToLinearSrgb([1, 0.85, 0.1, 1]) },
			] } },
		},
		zeroColor: { dataType: { kind: 'color' }, ui: { label: 'Zero Color', control: {} }, defaultValue: { inputSource: 'literal', value: [1, 1, 1, 1] } },
		overflowColor: { dataType: { kind: 'color' }, ui: { label: 'Overflow Color', control: {} }, defaultValue: { inputSource: 'literal', value: srgbToLinearSrgb([1, 0.1, 0.25, 1]) } },

	},
	primaryInputParameter: 'vector',
	resolutionInputParameters: ['vector'],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
