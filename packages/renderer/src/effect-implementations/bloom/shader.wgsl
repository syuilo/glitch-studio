struct Uniforms {
	strength: f32,
	threshold: f32,
	softKnee: f32,
	prefilterTexel: vec2f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var sourceSampler: sampler;
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(3) var detailTexture: texture_2d<f32>;

struct FragmentIn {
	@location(0) uv: vec2f,
};

fn texCoords(uv: vec2f) -> vec2f {
	return vec2f(uv.x, -uv.y) * 0.5 + 0.5;
}

fn sampleSource(uv: vec2f) -> vec4f {
	return textureSampleLevel(sourceTexture, sourceSampler, uv, 0.0);
}

fn highlight(uv: vec2f) -> vec4f {
	let source = sampleSource(uv);
	// Engine textures contain premultiplied RGB: don't multiply by alpha again.
	let color = max(source.rgb, vec3f(0.0));
	let brightness = max(max(color.r, color.g), color.b);
	let knee = uniforms.threshold * uniforms.softKnee;
	let soft = clamp(brightness - uniforms.threshold + knee, 0.0, 2.0 * knee);
	let contribution = max(brightness - uniforms.threshold, soft * soft / max(4.0 * knee, 0.00001));
	let rgb = color * (contribution / max(brightness, 0.00001));
	// Coverage lets the halo remain visible over transparent backgrounds.
	return vec4f(rgb, max(max(rgb.r, rgb.g), rgb.b));
}

@fragment
fn prefilter(frag: FragmentIn) -> @location(0) vec4f {
	let uv = texCoords(frag.uv);
	// 等倍なら画素中心を読む。半画素ずらすと細い光が抽出前に薄まってしまう。
	let sourceTexel = 1.0 / vec2f(textureDimensions(sourceTexture));
	let d = max(uniforms.prefilterTexel - sourceTexel, vec2f(0.0)) * 0.5;
	// Extract before averaging so small highlights aren't lost to the threshold.
	return (highlight(uv + vec2f(-d.x, -d.y))
		+ highlight(uv + vec2f(d.x, -d.y))
		+ highlight(uv + vec2f(-d.x, d.y))
		+ highlight(uv + vec2f(d.x, d.y))) * 0.25;
}

@fragment
fn downsample(frag: FragmentIn) -> @location(0) vec4f {
	let uv = texCoords(frag.uv);
	let d = 1.0 / vec2f(textureDimensions(sourceTexture));
	// Overlapping 13-tap filter reduces flicker as bright features move.
	let corners = sampleSource(uv + vec2f(-2.0, -2.0) * d)
		+ sampleSource(uv + vec2f(2.0, -2.0) * d)
		+ sampleSource(uv + vec2f(-2.0, 2.0) * d)
		+ sampleSource(uv + vec2f(2.0, 2.0) * d);
	let edges = sampleSource(uv + vec2f(-2.0, 0.0) * d)
		+ sampleSource(uv + vec2f(2.0, 0.0) * d)
		+ sampleSource(uv + vec2f(0.0, -2.0) * d)
		+ sampleSource(uv + vec2f(0.0, 2.0) * d);
	let inner = sampleSource(uv + vec2f(-1.0, -1.0) * d)
		+ sampleSource(uv + vec2f(1.0, -1.0) * d)
		+ sampleSource(uv + vec2f(-1.0, 1.0) * d)
		+ sampleSource(uv + vec2f(1.0, 1.0) * d);
	return sampleSource(uv) * 0.125 + corners * 0.03125 + edges * 0.0625 + inner * 0.125;
}

@fragment
fn upsample(frag: FragmentIn) -> @location(0) vec4f {
	let uv = texCoords(frag.uv);
	let d = 1.0 / vec2f(textureDimensions(sourceTexture));
	let corners = sampleSource(uv + vec2f(-d.x, -d.y))
		+ sampleSource(uv + vec2f(d.x, -d.y))
		+ sampleSource(uv + vec2f(-d.x, d.y))
		+ sampleSource(uv + vec2f(d.x, d.y));
	let edges = sampleSource(uv + vec2f(-d.x, 0.0))
		+ sampleSource(uv + vec2f(d.x, 0.0))
		+ sampleSource(uv + vec2f(0.0, -d.y))
		+ sampleSource(uv + vec2f(0.0, d.y));
	return (corners + edges * 2.0 + sampleSource(uv) * 4.0) * 0.0625;
}

@fragment
fn composite(frag: FragmentIn) -> @location(0) vec4f {
	let uv = texCoords(frag.uv);
	let source = sampleSource(uv);
	if (uniforms.strength <= 0.0) {
		return source;
	}
	let bloom = textureSampleLevel(detailTexture, sourceSampler, uv, 0.0);
	return clamp(source + bloom * uniforms.strength, vec4f(0.0), vec4f(1.0));
}
