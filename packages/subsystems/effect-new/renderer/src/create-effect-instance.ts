import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import type { TextureDataType } from '@gs/shared/data-type/data-type.ts';
import type { EffectGpuContext, EffectInitContext, EffectInstance, EffectRenderContext, NativeEffectImplementation } from './effect-instance.ts';
import { initCustomShaderEffect } from './custom-shader-effect.ts';
import { planEffect, type EffectPlacement } from './plan-effect.ts';
export type { EffectPlacement } from './plan-effect.ts';

function outputFormat(type: TextureDataType, enable32bitDataTextures: boolean): GPUTextureFormat {
	if (type.kind === 'color') return INTERMEDIATE_TEXTURE_FORMAT;
	const channels = type.kind === 'scalar' ? 'r' : type.kind === 'vector' ? 'rg' : 'rgba';
	return `${channels}${enable32bitDataTextures ? 32 : 16}float`;
}

export async function createEffectInstance(placement: EffectPlacement, gpu: EffectGpuContext,
	getNativeEffectImplementation: (id: string) => NativeEffectImplementation): Promise<EffectInstance> {
	const { steps, outputs } = planEffect(placement);
	const renderSteps: ((frame: EffectRenderContext) => void)[] = [];
	const historyResets: (() => void)[] = [];
	const disposers: (() => void)[] = [];

	function dispose(): void {
		// 部分的に初期化した場合も、借用した上流のリソースより先に下流を解放する。
		for (let index = disposers.length - 1; index >= 0; index--) disposers[index]();
		disposers.length = 0;
		renderSteps.length = 0;
		historyResets.length = 0;
		outputs.clear();
	}

	try {
		for (const step of steps) {
			if ('evaluate' in step) {
				renderSteps.push(step.evaluate);
				continue;
			}
			const { effect, resolution } = step;
			const outputTextures = new Map<string, GPUTexture>();
			const native = effect.type === 'nativeEffect' ? getNativeEffectImplementation(effect.id) : null;
			for (const [id, bind] of step.bindOutputTextures) {
				const texture = native?.createOutputTexture?.(id, resolution, gpu) ?? gpu.device.createTexture({
					size: resolution, format: outputFormat(effect.definition.outputDefs[id].dataType, gpu.enable32bitDataTextures),
					usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
				});
				outputTextures.set(id, texture);
				bind(texture);
				disposers.push(() => texture.destroy());
			}
			const context: EffectInitContext = { ...gpu, resolution, inputs: step.inputs, staticSettings: step.staticSettings, outputTextures };
			const operation = effect.type === 'customShaderEffect' ? await initCustomShaderEffect(effect.definition, context) : await native!.init(context, step.bindOutputTextures);
			renderSteps.push(frame => operation.render(frame));
			if (operation.resetRenderHistory != null) historyResets.push(operation.resetRenderHistory.bind(operation));
			disposers.push(() => operation.dispose());
		}
		return {
			outputs,
			render(frame) {
				for (const render of renderSteps) render(frame);
			},
			resetRenderHistory() {
				for (const reset of historyResets) reset();
			},
			dispose,
		};
	} catch (error) {
		dispose();
		throw error;
	}
}
