@group(0) @binding(1) var sourceSampler: sampler;
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;

fn sampleSource(uv: vec2f) -> vec4f {
	return textureSampleLevel(sourceTexture, sourceSampler, uv, 0.0);
}

@fragment
fn downsample(frag: FragmentIn) -> @location(0) vec4f {
	let uv = texCoords(frag.uv);
	// 軸ごとに広がりを調整し、半径0の軸では隣接画素を混ぜない。
	let d = uniforms.radiusScale / vec2f(textureDimensions(sourceTexture));
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
	let d = uniforms.radiusScale / vec2f(textureDimensions(sourceTexture));
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

