import { generateShaderInputs, createShaderInputBindings, shaderInputVariantKey } from '@gs/shared/gpu/shader-input.ts';
import { describeCustomShaderEffectInterface } from '@gs/subsystems_effect_shared/custom-shader-effect-definition.ts';
import type { ShaderInputSchema, ShaderInputValues } from '@gs/shared/gpu/shader-input.ts';
import type { CustomShaderEffectDefinition } from '@gs/subsystems_effect_shared/custom-shader-effect-definition.ts';
import type { EffectImplementation, EffectGpuContext } from '@gs/subsystems_effect_shared/effect-implementation.ts';

function outputFormat(kind: string, wgpu: Pick<EffectGpuContext, 'enable32bitDataTextures' | 'intermediateTextureFormat'>): GPUTextureFormat {
	if (kind === 'color') return wgpu.intermediateTextureFormat;
	const channels = kind === 'scalar' ? 'r' : kind === 'vector' ? 'rg' : 'rgba';
	return `${channels}${wgpu.enable32bitDataTextures ? 32 : 16}float` as GPUTextureFormat;
}

/** ユーザー本文を先頭に置き、診断の行・列を編集画面と一致させる。独自のWGSL構文解析は行わない。 */
export function generateCustomShaderEffectCode(definition: CustomShaderEffectDefinition, resolution: { width: number; height: number }): string {
	const shaderType = (kind: string) => kind === 'scalar' ? 'f32' : kind === 'vector' ? 'vec2f' : 'vec4f';
	const longSide = Math.max(resolution.width, resolution.height);
	return `${definition.code}\n${describeCustomShaderEffectInterface(definition)}
const gs_resolution = vec2f(${resolution.width}.0, ${resolution.height}.0);
fn get_resolution() -> vec2f { return gs_resolution; }
fn get_pixel_size() -> f32 { return 1.0 / ${longSide}.0; }
${definition.paramDefs.map((parameter, index) => `fn read_${parameter.nameForReference}(position: vec2f) -> ${shaderType(parameter.dataType.kind)} {
	// 共通の等方座標を、既存のfit/wrap/filterが受け取る内部画像参照座標へ戻す。
	return read_gs_input${index}(position * 2.0 * ${longSide}.0 / gs_resolution);
}`).join('\n')}
struct GsCustomShaderEffectFragmentOutput {
${definition.outputDefs.map((output, index) => `\t@location(${index}) gs_output${index}: ${shaderType(output.dataType.kind)},`).join('\n')}
};
@fragment fn gs_fragment(@location(0) position: vec2f) -> GsCustomShaderEffectFragmentOutput {
	let output = main(position * gs_resolution / (${longSide}.0 * 2.0));
	return GsCustomShaderEffectFragmentOutput(${definition.outputDefs.map(output => `output.${output.nameForReference}`).join(', ')});
}`;
}

/** 各使用箇所が独立したpipelineと入力bufferを所有し、全出力を一つのパスで描く。 */
export function createCustomShaderEffectImplementation(definition: CustomShaderEffectDefinition): EffectImplementation {
	const schema: ShaderInputSchema = Object.fromEntries(definition.paramDefs.map((parameter, index) => [`gs_input${index}`, parameter.dataType.kind]));
	return {
		outputTextureFactories: Object.fromEntries(definition.outputDefs.map(output => [output.id, ({ wgpu, resolution }) => {
			if (definition.outputDefs.length > wgpu.device.limits.maxColorAttachments) throw new Error('Custom Shader Effect exceeds the GPU output limit');
			return wgpu.device.createTexture({ size: resolution, format: outputFormat(output.dataType.kind, wgpu), usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT });
		}])),
		init: ({ wgpu, resolution, params, reportStatus }) => {
			const device = wgpu.device;
			let disposed = false;
			let generation = 0;
			let variantKey: string | null = null;
			let ready: { pipeline: GPURenderPipeline; bindings: ReturnType<typeof createShaderInputBindings> } | null = null;
			const inputsFor = (parameters: typeof params): ShaderInputValues => Object.fromEntries(definition.paramDefs.map((parameter, index) => [`gs_input${index}`, parameters[parameter.id]])) as ShaderInputValues;
			const prepare = (parameters: typeof params) => {
				const inputs = inputsFor(parameters);
				const key = shaderInputVariantKey(schema, inputs);
				if (key === variantKey) return;
				variantKey = key;
				const currentGeneration = ++generation;
				ready?.bindings.dispose();
				ready = null;
				reportStatus({ type: 'loading' });
				void (async () => {
					let bindings: ReturnType<typeof createShaderInputBindings> | null = null;
					try {
						const generated = generateShaderInputs(schema, inputs, 0, 'level0');
						bindings = createShaderInputBindings(device, generated);
						// 構文エラーは編集時の通常状態。Device全体の未捕捉エラーへ流さず、診断として返す。
						device.pushErrorScope('validation');
						const module = device.createShaderModule({ code: generateCustomShaderEffectCode(definition, resolution) + '\n' + generated.code });
						const validation = device.popErrorScope();
						const [compilation, shaderError] = await Promise.all([module.getCompilationInfo(), validation]);
						const errors = compilation.messages.filter(message => message.type === 'error');
						if (errors.length === 0 && shaderError != null) throw new Error(shaderError.message);
						if (errors.length > 0) throw new Error(errors.map(message => `${message.offset < definition.code.length ? `${message.lineNum}:${message.linePos}` : 'Generated shader'}: ${message.message}`).join('\n'));
						if (disposed || generation !== currentGeneration) return;
						const pipeline = await device.createRenderPipelineAsync({
							layout: device.createPipelineLayout({ bindGroupLayouts: [bindings.layout] }),
							vertex: { module: wgpu.defaultVertexShaderModule },
							fragment: { module, entryPoint: 'gs_fragment', targets: definition.outputDefs.map(output => ({ format: outputFormat(output.dataType.kind, wgpu) })) },
							primitive: { topology: 'triangle-list' },
						});
						if (disposed || generation !== currentGeneration) return;
						ready = { pipeline, bindings };
						bindings = null;
						reportStatus({ type: 'ready' });
					} catch (error) {
						if (!disposed && generation === currentGeneration) reportStatus({ type: 'error', message: error instanceof Error ? error.message : String(error) });
					} finally {
						bindings?.dispose();
					}
				})();
			};
			prepare(params);
			return {
				prepare,
				render: context => {
					if (ready == null) throw new Error('Custom Shader Effect is not compiled');
					const bindGroup = ready.bindings.update(inputsFor(context.params), resolution);
					const pass = context.createPassEncoder(context.commandEncoder, { colorAttachments: definition.outputDefs.map(output => ({ view: context.outputDataMap[output.id]!.textureView, clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store' })) });
					pass.setPipeline(ready.pipeline);
					pass.setBindGroup(0, bindGroup);
					pass.draw(3);
					pass.end();
				},
				dispose: () => { disposed = true; generation++; ready?.bindings.dispose(); ready = null; },
			};
		},
	};
}
