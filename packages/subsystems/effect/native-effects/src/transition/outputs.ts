import colorCode from './color.wgsl?raw';

export function transitionOutputs<Key extends string>(textures: ReadonlyMap<string, GPUTexture>, maskCode: string, maskInputs: Readonly<Record<Key, 'scalar'>>) {
	// 色出力がある場合だけ合成用のシェーダーと色入力を追加する。
	// Maskだけの配置では色入力を束縛せず、色のRender Targetも使わない。
	const color = textures.has('output');
	const both = color && textures.has('mask');
	return {
		code: color ? maskCode + '\n' + colorCode : maskCode,
		schema: color ? { ...maskInputs, inputA: 'color' as const, inputB: 'color' as const } : maskInputs,
		entryPoint: both ? 'fsBoth' : color ? 'fsColor' : 'fsMask',
		outputPorts: both ? ['output', 'mask'] : [color ? 'output' : 'mask'],
	};
}
