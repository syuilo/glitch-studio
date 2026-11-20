import { createEffectInstance, type EffectPlacement } from '@gs/subsystems_effect-new_renderer/create-effect-instance.ts';
import type { EffectFrameContext, EffectGpuContext, EffectInitContext, NativeEffectImplementation } from '@gs/subsystems_effect-new_renderer/effect-instance.ts';
import type definition from '../src/fx/testStructArray/_def_.ts';

declare const device: GPUDevice;
declare const defaultVertexShaderModule: GPUShaderModule;
declare const placement: EffectPlacement;
declare const frame: EffectFrameContext;
declare const native: (id: string) => NativeEffectImplementation;

// 【Canvasを持たないGPU環境で配置を初期化して描画する】
// 出力の利用側がCanvasや表示先を所有しない場合にも、通常の配置APIを利用できる。
const gpu: EffectGpuContext = { device, defaultVertexShaderModule, enable32bitDataTextures: false };
export async function checksPlacementRendering() {
	const instance = await createEffectInstance(placement, gpu, native);
	await instance.prepare(frame);
	const result: void = instance.render(frame, device.createCommandEncoder());
	// @ts-expect-error 使用ポートは初期化済みの配置では変更できない。
	instance.outputs.set('other', instance.outputs.get('output'));
	instance.dispose();
	return result;
}

// 【配置が要求した出力だけを読み取れる】
// 共通のレンダラーが保持するtextureは未要求の可能性があり、出力名だけで存在を仮定できない。
export function checksOutputPresence(context: EffectInitContext) {
	// @ts-expect-error 未要求のポートにはtextureが存在しない。
	context.outputTextures.get('output').createView();
	context.outputTextures.get('output')?.createView();
}

// 【ネストした構造体配列の入力型をNative Effectの初期化まで保持する】
// 動的な値が変わっても入力の種類は配置に固定されるため、配列要素をtextureとして直接扱えない。
export function checksStructuredInputs(context: Parameters<NativeEffectImplementation<typeof definition.paramDefs>['init']>[0]) {
	const element = context.inputs.buzzs.elements[0];
	// @ts-expect-error 構造体にはtextureがなく、個々のフィールドを参照する。
	element.texture.createView();
	return element.fields;
}
