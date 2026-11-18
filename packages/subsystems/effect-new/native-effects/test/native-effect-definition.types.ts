import { createTextureEffectInstance } from '@gs/subsystems_effect-new_renderer/texture-effect-instance.ts';
import type { EffectInstanceOptions } from '@gs/subsystems_effect-new_renderer/effect-instance.ts';
import type { ShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type definition from '../src/fx/decomposeVector/_def_.ts';

// 【Native Effect の実装は定義に存在する入力・出力だけを扱える】
// 新しい Native Effect のポートを変更したとき、対応する描画コードの修正漏れを型検査で見つける。
function checksNativeEffectPorts(options: EffectInstanceOptions, readInput: (input: ShaderInput) => void) {
	return createTextureEffectInstance<typeof definition>(options, {
		x: 'r16float', y: 'r16float',
		// @ts-expect-error 定義した出力は x と y のみ。
		z: 'r16float',
	}, outputs => ({
		render(request) {
			readInput(request.params.input);
			// @ts-expect-error 未定義の入力は評価されない。
			readInput(request.params.typo);
			// @ts-expect-error 未定義の出力テクスチャは存在しない。
			void outputs.typo;
		},
		dispose() {},
	}));
}

void checksNativeEffectPorts;
