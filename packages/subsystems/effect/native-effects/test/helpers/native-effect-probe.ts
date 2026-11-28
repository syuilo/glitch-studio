import type { Resolution } from '@gs/shared/resolution.ts';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import type { EffectFrameContext, EffectGpuContext, EffectParameterInput, EffectRenderOperation, NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { createTestInputs } from './native-inputs.ts';

export type TestOutputTextures<Outputs> = { [Port in keyof Outputs]?: GPUTexture };

function inputLayout(input: EffectParameterInput): unknown {
	switch (input.kind) {
		case 'array': return input.elements.map(inputLayout);
		case 'struct': return Object.values(input.fields).map(inputLayout);
		case 'texture': return [input.kind, input.resolution.width, input.resolution.height, input.sampling];
		default: return input.kind;
	}
}

/** 数値比較用の出力テクスチャを呼び出し元に貸し、実際のNative Effectでパスを記録する。 */
export function nativeEffectProbe(definition: EffectDefinition, implementation: NativeEffectImplementation) {
	return {
		createTexture(port: string, { wgpu, resolution }: { wgpu: EffectGpuContext; resolution: Resolution }) {
			if (implementation.createOutputTexture != null) return implementation.createOutputTexture(port, resolution, wgpu);
			const kind = definition.outputDefs[port].dataType.kind;
			const channels = kind === 'scalar' ? 'r' : kind === 'vector' ? 'rg' : 'rgba';
			const precision = kind === 'color' || !wgpu.enable32bitDataTextures ? 16 : 32;
			return wgpu.device.createTexture({ size: resolution, format: (channels + precision + 'float') as GPUTextureFormat,
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
		},
		place(wgpu: EffectGpuContext, resolution: Resolution | null = null, resources = {}) {
			let values: Record<string, unknown> = {};
			let operation: EffectRenderOperation | null = null;
			let layout: string | null = null;
			let bound = new Map<string, GPUTexture>();
			const published = new Map<string, GPUTexture>();
			const controller = new AbortController();
			return {
				async draw(options: { params: Record<string, unknown>; outputs: Record<string, GPUTexture>; usedOutputPorts?: ReadonlySet<string>;
					commandEncoder: GPUCommandEncoder; time?: number; timeDelta?: number;
					pointerPosition?: { x: number; y: number }; pointerVector?: { x: number; y: number };
					pointerStrokeSegments?: EffectFrameContext['pointerStrokeSegments'] }) {
					values = options.params;
					const inputs = createTestInputs(definition.paramDefs, () => values);
					const ports = options.usedOutputPorts ?? Object.keys(options.outputs);
					const textures = new Map(Array.from(ports, port => [port, options.outputs[port]] as const));
					const nextLayout = JSON.stringify(Object.values(inputs).map(inputLayout));
					// CPU値・同じ寸法の借用画像はgetterで更新できる。配線が異なる試行は新しい配置になる。
					if (operation == null || layout !== nextLayout || bound.size !== textures.size ||
						Array.from(textures).some(([port, texture]) => bound.get(port) !== texture)) {
						operation?.dispose();
						operation = null;
						published.clear();
						bound = textures;
						const target = textures.values().next().value!;
						operation = await implementation.init({ ...wgpu, resolution: resolution ?? { width: target.width, height: target.height }, inputs, resources, staticSettings: {},
							outputTextures: textures, signal: controller.signal },
						new Map(Array.from(textures.keys(), port => [port, texture => { published.set(port, texture); }])));
						layout = nextLayout;
					}
					const { time = 0, timeDelta = 0, pointerPosition, pointerVector, pointerStrokeSegments, commandEncoder } = options;
					const frame = { time, timeDelta, pointerPosition: pointerPosition == null ? undefined : [pointerPosition.x, pointerPosition.y] as const,
						pointerVector: pointerVector == null ? undefined : [pointerVector.x, pointerVector.y] as const, pointerStrokeSegments };
					await operation.prepare?.(frame, controller.signal);
					operation.render({ ...frame, commandEncoder });
				},
				output(port: string) { return published.get(port) ?? bound.get(port)!; },
				dispose() { controller.abort(); operation?.dispose(); operation = null; },
			};
		},
	};
}
export type NativeEffectProbe = ReturnType<typeof nativeEffectProbe>;

export { createTestInputs } from './native-inputs.ts';
