import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'streamlines',
	displayName: 'Streamlines',
	description: {
		'ja-JP': '現在のベクトル場を固定した格子状の開始点から前後に追跡し、流線を描きます。各地点の大きさをColor Rampで表し、一定間隔の矢印で方向を示します。',
		'en-US': 'Traces the current vector field forward and backward from fixed grid seeds. Streamlines use a magnitude color ramp and regularly spaced direction arrows.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['utility', 'convert'],
	paramDefs: {
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
				{ id: 'start', position: 0, color: [0.1, 0.6, 1, 1] },
				{ id: 'end', position: 1, color: [1, 0.85, 0.1, 1] },
			] } },
		},
		zeroColor: { dataType: { kind: 'color' }, ui: { label: 'Zero Color', control: {} }, defaultValue: { inputSource: 'literal', value: [1, 1, 1, 1] } },
		overflowColor: { dataType: { kind: 'color' }, ui: { label: 'Overflow Color', control: {} }, defaultValue: { inputSource: 'literal', value: [1, 0.1, 0.25, 1] } },
		directionSpace: {
			dataType: { kind: 'enum', options: ['component', 'displacement'] },
			ui: { label: 'Direction Space', control: { labels: { component: 'Vector Components', displacement: 'Image Displacement' } } },
			defaultValue: { inputSource: 'literal', value: 'component' },
		},
	},
	primaryInputParameter: 'vector',
	resolutionInputParameters: ['vector'],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
