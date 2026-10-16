struct Uniforms {
	horizontal: i32,
	vertical: i32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	var sourcePosition = position;
	// 原点が中央なので、元のUV座標での1 - uvは座標の符号反転になる。
	if ((uniforms.horizontal == -1 && position.x > 0.0) || (uniforms.horizontal == 1 && position.x < 0.0)) {
		sourcePosition.x = -sourcePosition.x;
	}
	// 移植元は+Yが下、共通入力は+Yが上のため、上下の判定を反転して鏡映方向を保つ。
	if ((uniforms.vertical == -1 && position.y < 0.0) || (uniforms.vertical == 1 && position.y > 0.0)) {
		sourcePosition.y = -sourcePosition.y;
	}
	return read_input(sourcePosition);
}
