// WGSLはViteのraw importでシェーダーソース文字列として読み込む。
declare module '*.wgsl?raw' {
	const source: string;
	export default source;
}
