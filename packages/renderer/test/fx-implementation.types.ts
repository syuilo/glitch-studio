import definition from '@glitch/shared/effect-definitions/test.ts';
import { defineEffect, type GetEffectOptionsSchemaValues } from '@glitch/shared/effect-definition.ts';
import { implementEffect } from '../src/effect-implementation.ts';
import '../src/effect-implementations/test/main.ts';

implementEffect<typeof definition>({
	getOut: ({ wgpu }) => wgpu.device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT }),
	init: ({ params }) => {
		params.x.toFixed();
		// @ts-expect-error Range parameters are numbers, not strings.
		const wrong: string = params.x;
		return {
			render: ({ params }) => {
				params.y.toFixed();
				// @ts-expect-error Only declared parameters are available.
				params.missing;
			},
			dispose: () => {},
		};
	},
});

type UnionValues = GetEffectOptionsSchemaValues<{
	value: { type: 'range'; label: string; min: number; max: number } | { type: 'bool'; label: string };
}>;
const numeric: UnionValues = { value: 1 };
const boolean: UnionValues = { value: true };
// @ts-expect-error Neither option accepts strings.
const invalid: UnionValues = { value: 'wrong' };

defineEffect({
	name: 'invalid', displayName: 'invalid',
	paramDefs: {
		// @ts-expect-error Literal defaults must match their parameter schema.
		x: { type: 'range', label: 'X', min: -1, max: 1, default: () => ({ type: 'literal', value: 'wrong' }) },
	},
	outputs: { output: { dataType: 'color' } },
});
