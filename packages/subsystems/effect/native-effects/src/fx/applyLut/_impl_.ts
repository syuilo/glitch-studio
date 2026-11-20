import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { createFixedInputPipeline, bindParameterValues, beginOutputPass } from '../../multipass.ts';
import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { readFileSource } from '@gs/shared/file-source.ts';
import { MAX_CUBE_FILE_BYTES, parseCubeLut } from './cube.ts';
import { createLutLayout, createLutResources } from './lut-resources.ts';
import code from './shader.wgsl?raw';
import colorSpaceShaderCode from '@gs/shared/gpu/color-space.wgsl?raw';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs, never, typeof definition.staticSettingDefs> = {
	async init(placement) {
		const { device, defaultVertexShaderModule, enable32bitDataTextures, resolution, inputs, outputTextures, resources } = placement;
		const params = bindParameterValues(inputs);
		const outputTexture = outputTextures.get('output')!;
		const outputView = outputTexture.createView();
		const file = resources.lut;
		if (file != null && file.size > MAX_CUBE_FILE_BYTES) throw new Error('Cube LUT exceeds the 128 MiB file limit.');
		const lut = file == null ? null : parseCubeLut(await (await readFileSource(file)).text());
		placement.signal?.throwIfAborted();
		const layout = createLutLayout(device);
		const resource = createLutResources(device, layout, enable32bitDataTextures, lut);
		const pipelines = createFixedInputPipeline(params, resolution, {
			device,
			vertex: defaultVertexShaderModule,
			code: colorSpaceShaderCode + '\n' + code,
			schema: { input: 'color' },
			targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }],
			internalLayouts: [layout],
		});
		return {
			cacheKey: 0,
			render: ctx => {
				resource.setColorSpaces(params.inputColorSpace, params.outputColorSpace);
				const pass = beginOutputPass(ctx.commandEncoder, outputView);
				pass.setPipeline(pipelines.pipeline);
				pass.setBindGroup(0, resource.bindGroup);
				pass.setBindGroup(pipelines.inputGroup, pipelines.getBindGroup());
				pass.draw(3);
				pass.end();
			},
			dispose: () => {
				resource.dispose();
				pipelines.dispose();
			},
		};
	},
};

export default implementation;
