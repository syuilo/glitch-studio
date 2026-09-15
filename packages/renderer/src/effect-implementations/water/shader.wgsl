// Water by Paper Design, Apache-2.0 (see LICENSE).
// https://github.com/paper-design/shaders/blob/main/packages/shaders/src/shaders/water.ts
// Modified: GLSL -> WGSL, live node input, no background color or fit selector,
// and premultiplied input RGB is preserved without multiplying alpha twice.
// Water-like surface distortion with natural caustic realism.
// Works as an image filter or standalone animated texture.
struct Uniforms {
	colorHighlight: vec4f, // Highlight color in RGBA, needs highlights > 0
	aspectRatio: f32,
	time: f32,
	highlights: f32, // Coloring following caustic shape, needs colorHighlight alpha > 0 (0 to 1)
	layering: f32, // Power of 2nd layer of caustic distortion (0 to 1)
	edges: f32, // Caustic distortion power on the image edges (0 to 1)
	waves: f32, // Additional simplex noise distortion, independent from caustic (0 to 1)
	caustic: f32, // Power of caustic distortion, needs image (0 to 1)
	size: f32, // Pattern scale relative to the image (0.01 to 7)
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var sourceSampler: sampler;
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;

struct FragmentIn { @location(0) uv: vec2f };

fn rotate2D(r: f32) -> mat2x2f {
	return mat2x2f(cos(r), sin(r), -sin(r), cos(r));
}

fn getCausticNoise(point: vec2f, t: f32, initialScale: f32) -> f32 {
	var uv = point;
	var scale = initialScale;
	var n = vec2f(0.1);
	var N = vec2f(0.1);
	let m = rotate2D(0.5);
	for (var j = 0; j < 6; j++) {
		// The original uses row-vector multiplication (uv *= m), not m * uv.
		uv = uv * m;
		n = n * m;
		let q = uv * scale + vec2f(f32(j)) + n + vec2f((0.5 + 0.5 * f32(j)) * (f32(j % 2) - 1.0) * t);
		n += sin(q);
		N += cos(q) / scale;
		scale *= 1.1;
	}
	return N.x + N.y + 1.0;
}

// Simplex noise from Paper's shader-utils.ts, with GLSL mod made explicit.
fn permute(x: vec3f) -> vec3f {
	let p = ((x * 34.0) + vec3f(1.0)) * x;
	return p - floor(p / 289.0) * 289.0;
}
fn snoise(v: vec2f) -> f32 {
	let C = vec4f(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
	var i = floor(v + vec2f(dot(v, C.yy)));
	let x0 = v - i + vec2f(dot(i, C.xx));
	let i1 = select(vec2f(0.0, 1.0), vec2f(1.0, 0.0), x0.x > x0.y);
	let x12 = x0.xyxy + C.xxzz - vec4f(i1, 0.0, 0.0);
	i = i - floor(i / 289.0) * 289.0;
	let p = permute(permute(vec3f(i.y) + vec3f(0.0, i1.y, 1.0)) + vec3f(i.x) + vec3f(0.0, i1.x, 1.0));
	var m = max(vec3f(0.5) - vec3f(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), vec3f(0.0));
	m *= m;
	m *= m;
	let x = 2.0 * fract(p * C.www) - vec3f(1.0);
	let h = abs(x) - vec3f(0.5);
	let ox = floor(x + vec3f(0.5));
	let a0 = x - ox;
	m *= vec3f(1.79284291400159) - 0.85373472095314 * (a0 * a0 + h * h);
	let g = vec3f(a0.x * x0.x + h.x * x0.y, a0.yz * x12.xz + h.yz * x12.yw);
	return 130.0 * dot(m, g);
}

@fragment
fn fs(frag: FragmentIn) -> @location(0) vec4f {
	var imageUV = vec2f(frag.uv.x, -frag.uv.y) * 0.5 + vec2f(0.5);
	var patternUV = (imageUV - vec2f(0.5)) * vec2f(uniforms.aspectRatio, 1.0);
	patternUV /= 0.01 + 0.09 * uniforms.size;
	let t = uniforms.time;
	let wavesNoise = snoise((0.3 + 0.1 * sin(t)) * 0.1 * patternUV + vec2f(0.0, 0.4 * t));
	var causticNoise = getCausticNoise(patternUV + uniforms.waves * vec2f(1.0, -1.0) * wavesNoise, 2.0 * t, 1.5);
	if (uniforms.layering > 0.0) {
		causticNoise += uniforms.layering * getCausticNoise(patternUV + 2.0 * uniforms.waves * vec2f(1.0, -1.0) * wavesNoise, 1.5 * t, 2.0);
	}
	causticNoise *= causticNoise;

	var edgesDistortion = smoothstep(0.0, 0.1, imageUV.x);
	edgesDistortion *= smoothstep(0.0, 0.1, imageUV.y);
	edgesDistortion *= smoothstep(1.0, 1.1, imageUV.x) + (1.0 - smoothstep(0.8, 0.95, imageUV.x));
	edgesDistortion *= 1.0 - smoothstep(0.9, 1.0, imageUV.y);
	edgesDistortion = mix(edgesDistortion, 1.0, uniforms.edges);
	let causticNoiseDistortion = 0.02 * causticNoise * edgesDistortion;
	let wavesDistortion = 0.1 * uniforms.waves * wavesNoise;
	imageUV += vec2f(wavesDistortion, -wavesDistortion);
	imageUV += vec2f(uniforms.caustic * causticNoiseDistortion);

	// Mirror-repeat sampling reflects displaced UVs at the image edges.
	let image = textureSampleLevel(sourceTexture, sourceSampler, imageUV, 0.0);
	// Engine textures already carry premultiplied RGB.
	var color = image.rgb;
	var opacity = image.a;
	causticNoise = max(-0.2, causticNoise);
	let highlight = 0.025 * uniforms.highlights * causticNoise * uniforms.colorHighlight.a;
	color = mix(color, uniforms.colorHighlight.rgb, 0.05 * uniforms.highlights * causticNoise * uniforms.colorHighlight.a);
	opacity += highlight;
	color += vec3f(highlight * (0.5 + 0.5 * wavesNoise));
	opacity += highlight * (0.5 + 0.5 * wavesNoise);
	return vec4f(color, clamp(opacity, 0.0, 1.0));
}
