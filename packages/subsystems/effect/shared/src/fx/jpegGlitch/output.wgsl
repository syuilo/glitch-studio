@group(0) @binding(3) var<storage, read> decoded: array<f32>;

struct FragmentIn {
	@location(0) uv: vec2f,
};

fn component_sample(pixel: vec2i, component: u32) -> f32 {
	let stride = select(1u, 2u, uniforms.subsample != 0u && component != 0u);
	let size = vec2i(ceil(uniforms.virtualSize / f32(stride)));
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
	// DCTのブロック・成分は補間すると意味が変わるため、整数位置でバッファを読む。
	return decoded[block * 64u + (point.y % 8u) * 8u + point.x % 8u];
}

fn sample_component(imagePosition: vec2f, component: u32) -> f32 {
	let stride = select(1.0, 2.0, uniforms.subsample != 0u && component != 0u);
	let pixel = imagePosition * uniforms.virtualSize / stride - 0.5;
	let base = vec2i(floor(pixel));
	let weight = fract(pixel);
	// 仮想画像の拡大と色差の復元は、同じ成分の隣接サンプル間で双線形補間する。
	return mix(
		mix(component_sample(base, component), component_sample(base + vec2i(1, 0), component), weight.x),
		mix(component_sample(base + vec2i(0, 1), component), component_sample(base + vec2i(1, 1), component), weight.x),
		weight.y,
	);
}

@fragment
fn fs(fragment: FragmentIn) -> @location(0) vec4f {
	let original = read_input(fragment.uv);
	if (original.a <= 0.0) { return vec4f(0.0); }
	let imagePosition = fragment.uv * vec2f(0.5, -0.5) + 0.5;
	let y = sample_component(imagePosition, 0u);
	let cb = sample_component(imagePosition, 1u);
	let cr = sample_component(imagePosition, 2u);
	let rgb = clamp(vec3f(y + 1.402 * cr, y - 0.344136 * cb - 0.714136 * cr, y + 1.772 * cb), vec3f(0.0), vec3f(1.0));
	// JPEGはalphaを持たない。元の透明度を保持し、色の復号後に一度だけpremultiplyする。
	return vec4f(rgb * original.a, original.a);
}
