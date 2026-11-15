struct Uniforms {
	coordinateScale: vec2f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	// 座標場は出力位置で読む。その値は変位ではなく参照先の絶対座標なので、
	// 現在位置へ加減算せず、共通単位から内部座標へ換算して画像を読む。
	let coordinates = read_coordinates(position);
	// Fit・Wrap・Filterとpremultiplied alphaは通常の画像入力に任せる。
	return read_input(coordinates * uniforms.coordinateScale);
}
