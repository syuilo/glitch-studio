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
		prepare(request) {
			readInput(request.params.input);
			// @ts-expect-error 準備だけでGPUコマンドを記録すると、スキップしたフレームでも描画が進んでしまう。
			void request.commandEncoder;
		},
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

// 【Native Effect の描画は同期的にコマンドを記録する】
// awaitの後にエンコーダーへ記録する実装を受け入れると、呼び出し側のsubmitに間に合わない。
type TextureEffectImplementation = ReturnType<Parameters<typeof createTextureEffectInstance<typeof definition>>[2]>;
// @ts-expect-error GPU準備の待機はprepareが所有し、renderをasync関数にできない。
const asynchronousRender: TextureEffectImplementation['render'] = async () => {};
void asynchronousRender;
