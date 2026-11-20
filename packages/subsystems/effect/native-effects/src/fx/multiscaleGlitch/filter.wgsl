struct FilterUniforms {
	step: vec2f,
};

@group(0) @binding(0) var<uniform> filterUniforms: FilterUniforms;
@group(0) @binding(1) var sourceSampler: sampler;
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;

struct FragmentIn {
	@location(0) uv: vec2f,
};

fn source_at(uv: vec2f) -> vec4f {
	return textureSampleLevel(sourceTexture, sourceSampler, uv, 0.0);
}

@fragment
fn downsample(fragment: FragmentIn) -> @location(0) vec4f {
	let uv = fragment.uv * vec2f(0.5, -0.5) + 0.5;
	let offset = 0.5 / vec2f(textureDimensions(sourceTexture));
	return (
		source_at(uv + vec2f(-offset.x, -offset.y))
		+ source_at(uv + vec2f(offset.x, -offset.y))
		+ source_at(uv + vec2f(-offset.x, offset.y))
		+ source_at(uv + vec2f(offset.x, offset.y))
	) * 0.25;
}

@fragment
fn gaussian(fragment: FragmentIn) -> @location(0) vec4f {
	let uv = fragment.uv * vec2f(0.5, -0.5) + 0.5;
	var result = vec4f(0.0);
	var totalWeight = 0.0;
	// sigmaの半分ごとにサンプルを置き、±3 sigmaまでの13タップで分離Gaussianを計算する。
	// stepは画面短辺に対する長さからUVへ変換済みなので、解像度や縦横比に依存しない。
	for (var i = -6i; i <= 6i; i++) {
		let distance = f32(i) * 0.5;
		let weight = exp(-0.5 * distance * distance);
		result += source_at(uv + filterUniforms.step * distance) * weight;
		totalWeight += weight;
	}
	return result / totalWeight;
}
