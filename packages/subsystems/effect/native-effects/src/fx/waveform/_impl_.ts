import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { createWaveform } from '@gs/shared/utility/waveform/waveform.ts';
import { bindParameterValues, beginOutputPass } from '../../multipass.ts';
import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { device, defaultVertexShaderModule, resolution, inputs: parameterInputs, outputTextures } = context;
		const params = bindParameterValues(parameterInputs);
		const outputTexture = outputTextures.get('output')!;
		const outputView = outputTexture.createView();
		const waveform = createWaveform({ device, vertexShaderModule: defaultVertexShaderModule, format: INTERMEDIATE_TEXTURE_FORMAT, fixedInput: { input: params.input, fitSize: resolution } });
		return {
			cacheKey: 0,
			render({ commandEncoder }) {
				const divisor = Number(params.resolution);
				if (waveform.prepare(params.input, {
					// 間引き解像度やグラフの方向ではなく、最終出力の比率でfitする。
					fitSize: outputTexture,
					mode: params.mode,
					direction: params.direction,
					intensity: params.intensity,
					size: {
						width: Math.max(1, Math.ceil(resolution.width / divisor)),
						height: Math.max(1, Math.ceil(resolution.height / divisor)),
					},
				}, commandEncoder)) {
					const pass = commandEncoder.beginComputePass();
					waveform.accumulate(pass);
					pass.end();
				}
				const pass = beginOutputPass(commandEncoder, outputView);
				waveform.render(pass);
				pass.end();
			},
			dispose: () => waveform.dispose(),
		};
	},
};

export default implementation;
