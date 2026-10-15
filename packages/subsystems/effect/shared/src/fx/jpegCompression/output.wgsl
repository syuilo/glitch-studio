@group(0) @binding(1) var<storage, read> decoded: array<f32>;
@group(0) @binding(2) var<storage, read> referenceSamples: array<f32>;

struct FragmentIn {
	@location(0) uv: vec2f,
};

fn component_sample(pixel: vec2i, component: u32) -> vec2f {
	let stride = select(1u, 2u, uniforms.subsample != 0u && component != 0u);
	// 中央原点では四辺のパディングも含む領域を使い、左上原点では画像の端で制限する。
	var size = vec2i(ceil(uniforms.virtualSize / f32(stride)));
	if (uniforms.originAtCenter != 0u) { size = vec2i(uniforms.gridSize / stride); }
	let point = vec2u(clamp(pixel, vec2i(0), size - 1));
	let blockPosition = point / 8u;
	var mcu = blockPosition;
	var slot = component;
	if (uniforms.subsample != 0u) {
		if (component == 0u) {
			mcu = blockPosition / 2u;
			slot = (blockPosition.y % 2u) * 2u + blockPosition.x % 2u;
		} else {
			slot = component + 3u;
		}
	}
	let block = (mcu.y * uniforms.mcuColumns + mcu.x) * uniforms.blocksPerMcu + slot;
	// 8×8ブロックのサンプルと成分を厳密に指定するため、整数位置でバッファを読む。
	let index = block * 64u + (point.y % 8u) * 8u + point.x % 8u;
	var reference = 0.0;
	if (uniforms.preserveDetails != 0u) { reference = referenceSamples[index]; }
	return vec2f(decoded[index], reference);
}

fn sample_component(imagePosition: vec2f, component: u32) -> vec2f {
	let stride = select(1.0, 2.0, uniforms.subsample != 0u && component != 0u);
	let pixel = image_to_grid(imagePosition) / stride - 0.5;
	let base = vec2i(floor(pixel));
	let weight = fract(pixel);
	// 仮想画像の拡大と色差の復元で、圧縮結果と比較画像に同じ双線形補間を適用する。
	return mix(
		mix(component_sample(base, component), component_sample(base + vec2i(1, 0), component), weight.x),
		mix(component_sample(base + vec2i(0, 1), component), component_sample(base + vec2i(1, 1), component), weight.x),
		weight.y,
	);
}

fn ycbcr_to_rgb(color: vec3f) -> vec3f {
	return vec3f(color.x + 1.402 * color.z, color.x - 0.344136 * color.y - 0.714136 * color.z, color.x + 1.772 * color.y);
}

@fragment
fn fs(fragment: FragmentIn) -> @location(0) vec4f {
	let original = read_input(fragment.uv);
	if (original.a <= 0.0) { return vec4f(0.0); }
	let imagePosition = fragment.uv * vec2f(0.5, -0.5) + 0.5;
	let y = sample_component(imagePosition, 0u);
	let cb = sample_component(imagePosition, 1u);
	let cr = sample_component(imagePosition, 2u);
	var rgb = ycbcr_to_rgb(vec3f(y.x, cb.x, cr.x));
	if (uniforms.preserveDetails != 0u) {
		let referenceRgb = ycbcr_to_rgb(vec3f(y.y, cb.y, cr.y));
		// 元画像 + (圧縮画像 - 未圧縮の縮小画像) とし、縮小で消えた細部を復元する。
		// 低解像度でのJPEG圧縮の変化を残しつつ、画面全体がぼけることを抑える。
		rgb = original.rgb / original.a + (rgb - referenceRgb);
	}
	rgb = clamp(rgb, vec3f(0.0), vec3f(1.0));
	// JPEG自体にはalphaがないため、元の透明度を維持し、色の処理後に一度だけ乗算する。
	return vec4f(rgb * original.a, original.a);
}
