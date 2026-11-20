import colorCode from './color.wgsl?raw';

export function transitionOutputs<Key extends string>(textures: ReadonlyMap<string, GPUTexture>, maskCode: string, maskInputs: Readonly<Record<Key, 'scalar'>>) {
	const color = textures.has('output');
	const both = color && textures.has('mask');
	return {
		code: color ? maskCode + '\n' + colorCode : maskCode,
		schema: color ? { ...maskInputs, inputA: 'color' as const, inputB: 'color' as const } : maskInputs,
		entryPoint: both ? 'fsBoth' : color ? 'fsColor' : 'fsMask',
		outputPorts: both ? ['output', 'mask'] : [color ? 'output' : 'mask'],
	};
}
