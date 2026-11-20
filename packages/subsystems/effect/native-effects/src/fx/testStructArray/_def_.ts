import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Test of Struct and Array',
	summary: {
		'ja-JP': '構造体・配列パラメータの受け渡しを確認する、開発用のエフェクトです。',
		'en-US': 'A development effect for checking how struct and array parameters are passed.',
	},
	kind: 'generate',
	dependsOnRenderHistory: false,
	tags: ['utility'],
	paramDefs: {
		foo: {
			dataType: { kind: 'struct', fields: { node: { kind: 'color' } } },
			ui: { label: 'Foo', control: { fields: { node: { label: 'Node', control: {} } } } },
			defaultValue: { node: [0, 0, 0, 0] },
			fields: { node: { canNode: true, defaultValue: [0, 0, 0, 0] } },
		},
		bars: {
			dataType: { kind: 'array', elementType: { kind: 'color' } },
			ui: { label: 'Bars', control: { element: {} } },
			defaultValue: [],
			element: { defaultValue: [0, 1, 0, 1] },
		},
		buzzs: {
			dataType: { kind: 'array', elementType: { kind: 'struct', fields: { image: { kind: 'color' }, x: { kind: 'scalar' }, y: { kind: 'scalar' } } } },
			ui: {
				label: 'Buzzs',
				control: {
					element: {
						fields: {
							image: { label: 'Image', control: {} },
							x: {
								label: 'X',
								control: {
									controlType: 'range',
									min: -1,
									max: 1,
									step: 0.01,
								},
							},
							y: {
								label: 'Y',
								control: {
									controlType: 'range',
									min: -1,
									max: 1,
									step: 0.01,
								},
							},
						},
					},
				},
			},
			defaultValue: [
				{ image: [0, 0, 1, 1], x: 0, y: 0 },
			],
			element: {
				defaultValue: { image: [0, 0, 1, 1], x: 0, y: 0 },
				fields: { image: { canNode: true, defaultValue: [0, 0, 1, 1] }, x: { defaultValue: 0 }, y: { defaultValue: 0 } },
			},
		},
	},
	primaryInputParameter: null,
	resolutionInputParameters: [],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
		output2: { dataType: { kind: 'scalar' } },
		output3: { dataType: { kind: 'vector' } },
	},
	primaryOutput: 'output',
});
