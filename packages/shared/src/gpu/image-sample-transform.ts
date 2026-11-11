/**
 * 集計時に読むRGBAへの変換。呼び出し側のドメインや表示設定を集計器へ持ち込まない。
 * WGSLは指定groupの資源宣言とfn transformImageSample(input: vec4f) -> vec4fを提供する。
 */
export type GpuImageSampleTransform = {
	readonly bindGroupLayout: GPUBindGroupLayout;
	getShaderCode(bindGroupIndex: number): string;
	getBindGroup(): GPUBindGroup;
};
