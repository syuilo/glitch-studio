struct Uniforms {
	rasterSize: vec2f,
};

struct RowState {
	beforeRow: f32,
	beforeColumn: f32,
	afterRow: f32,
	afterColumn: f32,
	splitPosition: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> rowStates: array<RowState>;

struct FragmentIn {
	@location(0) uv: vec2f,
};

@fragment
fn fs(fragment: FragmentIn) -> @location(0) vec4f {
	let original = read_input(fragment.uv);
	let imagePosition = fragment.uv * vec2f(0.5, -0.5) + 0.5;
	let rasterPosition = imagePosition * uniforms.rasterSize;
	let row = min(u32(floor(rasterPosition.y)), u32(uniforms.rasterSize.y) - 1u);
	let state = rowStates[row];
	let afterSplit = rasterPosition.x >= state.splitPosition;
	let sourceRow = select(state.beforeRow, state.afterRow, afterSplit);
	let sourceColumn = select(state.beforeColumn, state.afterColumn, afterSplit);
	if (sourceRow == f32(row) && sourceColumn == 0.0) { return original; }

	// 仮想画素の中心へ丸めず、行内の小数座標を維持する。仮想ラスタは
	// 読み取りアドレスを決めるためだけに使い、入力を低解像度画像へ変換しない。
	let column = rasterPosition.x + sourceColumn;
	let rowCarry = floor(column / uniforms.rasterSize.x);
	let sourcePixel = vec2f(
		column - rowCarry * uniforms.rasterSize.x,
		sourceRow + rowCarry + (rasterPosition.y - f32(row)),
	);
	let sourcePosition = sourcePixel / uniforms.rasterSize;
	let distorted = read_input(sourcePosition * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0));
	// 位置の変更ではRGBAをまとめて移動し、元画像との合成もpremultipliedのまま行う。
	return distorted;
}
