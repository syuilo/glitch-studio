@group(1) @binding(0) var lightnessTexture: texture_2d<f32>;
@group(1) @binding(1) var lightnessSampler: sampler;

fn readWeightedLightness(position: vec2f) -> vec2f {
	return textureSampleLevel(lightnessTexture, lightnessSampler, position * vec2f(0.5, -0.5) + 0.5, 0.0).rg;
}
