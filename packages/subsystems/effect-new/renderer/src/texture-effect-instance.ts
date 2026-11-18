import type { UniformOrTexture } from '@gs/shared/gpu/uniform-or-texture.ts';
import type { ShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { ParameterDefaultValue } from '@gs/shared/parameter/parameter-definition.ts';
import type { EffectDefinition, EffectParameterDefinition } from '@gs/subsystems_effect-new_shared/effect-definition.ts';
import type { EffectFrameRequest, EffectInstanceImplementation, EffectInstanceOptions, EffectRenderRequest } from './effect-instance.ts';

type TextureOutput = { texture: GPUTexture; view: GPUTextureView };

type EvaluatedParameter<Parameter extends EffectParameterDefinition> =
	| ('canNode' extends keyof Parameter ? true extends Parameter['canNode'] ? ShaderInput : never : never)
	| (Parameter extends { canNode: true } ? never : ParameterDefaultValue<Parameter['dataType']>['value']);

type TextureEffectParameters<Definition extends EffectDefinition> = {
	readonly [Id in keyof Definition['paramDefs']]: EvaluatedParameter<Definition['paramDefs'][Id]>;
};

type OutputPort<Definition extends EffectDefinition> = Extract<keyof Definition['outputDefs'], string>;

/** 全出力を同じ寸法で確保する描画実装向け。借用入力とグラフ境界の直結出力は所有しない。 */
export function createTextureEffectInstance<Definition extends EffectDefinition = EffectDefinition>(
	options: EffectInstanceOptions,
	formats: Readonly<Record<OutputPort<Definition>, GPUTextureFormat>>,
	initialize: (outputs: Readonly<Record<OutputPort<Definition>, TextureOutput>>) => {
		prepare?: (request: EffectFrameRequest<TextureEffectParameters<Definition>>) => void | Promise<void>;
		// voidを戻り型にするとTypeScriptがasync関数も許す。コマンドの記録は呼び出し中に完了させる。
		render: (request: EffectRenderRequest<TextureEffectParameters<Definition>>) => undefined;
		dispose: () => void;
	},
): EffectInstanceImplementation {
	const { device, resolution } = options;
	const textures = new Map<string, GPUTexture>();
	const outputs = Object.create(null) as Record<OutputPort<Definition>, TextureOutput>;
	let implementation: ReturnType<typeof initialize>;
	let preparedFrame: EffectFrameRequest<TextureEffectParameters<Definition>> | null = null;
	let disposed = false;
	const assertActive = () => {
		if (disposed) throw new Error('Effect instance was disposed');
	};
	const releaseTextures = () => {
		for (const texture of textures.values()) texture.destroy();
		textures.clear();
	};
	try {
		for (const port of Object.keys(formats) as OutputPort<Definition>[]) {
			const texture = device.createTexture({
				size: resolution,
				format: formats[port],
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
			});
			textures.set(port, texture);
			outputs[port] = { texture, view: texture.createView() };
		}
		implementation = initialize(outputs);
	} catch (error) {
		releaseTextures();
		throw error;
	}
	return {
		getOutputResolution: port => textures.has(port) ? resolution : null,
		prepare(request) {
			assertActive();
			preparedFrame = null;
			const result = new Map<string, UniformOrTexture>();
			for (const port of request.requestedOutputIds) {
				const texture = textures.get(port);
				if (texture != null) result.set(port, { kind: 'texture', texture });
			}
			if (result.size === 0) return { outputs: result };
			// createEffectInstance が定義に沿って既定値を補い、接続可能な入力を ShaderInput に変換済み。
			// 登録時に消去された個別の定義型を実装へ戻す境界をここに集める。
			const frame = request as EffectFrameRequest<TextureEffectParameters<Definition>>;
			const pending = implementation.prepare?.(frame);
			preparedFrame = frame;
			return { outputs: result, pending: pending ?? null };
		},
		render(commandEncoder) {
			assertActive();
			const frame = preparedFrame;
			preparedFrame = null;
			if (frame != null) implementation.render({ ...frame, commandEncoder });
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			preparedFrame = null;
			try {
				implementation.dispose();
			} finally {
				releaseTextures();
			}
		},
	};
}
