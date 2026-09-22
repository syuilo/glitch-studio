// 既存のエフェクト計算のUVを、入力参照APIの中央原点・+Yが上の座標へ戻す。
fn inputPosition(uv: vec2f) -> vec2f {
	return (uv * 2.0 - 1.0) * vec2f(1.0, -1.0);
}

fn convertTexCoords(uv: vec2f) -> vec2f {
	return vec2f(uv.x, -uv.y) * 0.5 + vec2f(0.5);
}

struct Uniforms {
	cellSize: vec2f,
	border: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct FragmentIn {
	@location(0) uv: vec2f,
};

@fragment
fn fs(fragData: FragmentIn) -> @location(0) vec4f {
	let uv = convertTexCoords(fragData.uv);
	let gridPosition = (uv - 0.5) / uniforms.cellSize;
	let localPosition = fract(gridPosition);
	let cellCenter = 0.5 + (floor(gridPosition) + 0.5) * uniforms.cellSize;
	let sourceColor = read_input(inputPosition(cellCenter));

	var rgb: vec3f;
	if (localPosition.x < 1.0 / 3.0) {
		rgb = vec3f(sourceColor.r, 0.0, 0.0);
	} else if (localPosition.x < 2.0 / 3.0) {
		rgb = vec3f(0.0, sourceColor.g, 0.0);
	} else {
		rgb = vec3f(0.0, 0.0, sourceColor.b);
	}

	// 横幅がセルの1/3であるサブピクセルに合わせ、縦横の枠を同じ太さにする。
	let subpixelPosition = fract(vec2f(localPosition.x * 3.0, localPosition.y));
	let distanceToEdge = min(subpixelPosition, 1.0 - subpixelPosition);
	if (distanceToEdge.x < uniforms.border * 0.5 || distanceToEdge.y < uniforms.border / 6.0) {
		rgb = vec3f(0.0);
	}

	// 入力は既にpremultiplied alphaなので、RGBへ再度alphaを乗算しない。
	return vec4f(rgb, sourceColor.a);
}
