struct Uniforms {
	canvasSize: vec2f,
	cellSize: vec2f,
	padding: f32,
	gap: f32,
	vertical: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	if (count_inputs == 0u || any(uniforms.cellSize <= vec2f(0.0))) { return vec4f(0.0); }
	// 左上を原点にすると、配列順が横では左から右、縦では上から下になる。
	let pixelPosition = (position * vec2f(0.5, -0.5) + 0.5) * uniforms.canvasSize - uniforms.padding;
	if (any(pixelPosition < vec2f(0.0))) { return vec4f(0.0); }
	let vertical = uniforms.vertical != 0u;
	let axisPosition = select(pixelPosition.x, pixelPosition.y, vertical);
	let stride = select(uniforms.cellSize.x, uniforms.cellSize.y, vertical) + uniforms.gap;
	let inputIndex = u32(floor(axisPosition / stride));
	if (inputIndex >= count_inputs) { return vec4f(0.0); }
	let offset = f32(inputIndex) * stride;
	let localPosition = pixelPosition - select(vec2f(offset, 0.0), vec2f(0.0, offset), vertical);
	// Wrapは画像の参照方法にだけ適用し、間隔・外周余白や隣の領域へ画像を漏らさない。
	if (any(localPosition >= uniforms.cellSize)) { return vec4f(0.0); }
	let sourcePosition = localPosition / uniforms.cellSize * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0);
	// 入力は乗算済みRGBA。再乗算やclampをせず、半透明・HDR・負値を保持する。
	return read_inputs(inputIndex, sourcePosition);
}
