declare module '*?shader' {
	/** WGSLと同じビルド入力から生成する。配置情報を手作業で同期させない。 */
	export const uniforms: import('./shader-buffer.ts').ShaderBufferLayouts['uniforms'];
	export const storages: import('./shader-buffer.ts').ShaderBufferLayouts['storages'];
	export const structs: import('./shader-buffer.ts').ShaderBufferLayouts['structs'];
	const code: string;
	export default code;
}
