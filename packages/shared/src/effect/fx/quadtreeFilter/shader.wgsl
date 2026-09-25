struct Uniforms {
	minDivisions: f32,
	maxIterations: u32,
	threshold: f32,
	borderAbsolute: u32,
	borderWidth: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct FragmentIn {
	@location(0) uv: vec2f,
};

// @license MIT
// @author ciphrd
// 
// This algorithm is sort of a probabilistic quad tree construction where quad divisions are 
// added if the color variation (variance) in a quad is too important.
// 
// The color variation is computed by taking n samples within the quad, and then we compute the 
// variance on each color component of the samples.
//
//
// Limitations
// 
// If a certain area, which is large, has a small section of it being detailed while the rest
// is pretty much linear, divisions might not be added. Because this algorithm picks random
// points in the quad, the small detailed section has little to no infuence on the overall
// variations of the colors in the quad.
// You can observe this behavior on the Google logo when it appears.
//

// the number of samples picked fter each quad division
const SAMPLES_PER_ITERATION = 30;

// taken from http://glslsandbox.com/e#41197.0
fn hash22(p: vec2f) -> vec2f { 
	let n = sin(dot(p, vec2f(41.0, 289.0)));
	return fract(vec2f(262144.0, 32768.0) * n);    
}

// Computes the color variation on a quad division of the space
// Basically, this method takes n random samples in a given quad, compute the average 
// of each color component of the samples.
// Then, it computes the variance of the samples
// This is the way I thought for computing the color variation, there might be others,
// and there must be better ones
fn quadColorVariation(center: vec2f, size: f32) -> vec4f {
	var sum = vec3f(0.0);
	var sumSquares = vec3f(0.0);
	// 同じセルの画素は同じ位置をサンプリングする。
	// 分散はE[X²] - E[X]²で求められるので、サンプルの保存と再走査は不要。
	for (var i = 0; i < SAMPLES_PER_ITERATION; i++) {
		let r = hash22(center + vec2f(f32(i), 0.0)) - 0.5;
		let sample = read_input(center + r * size).rgb;
		sum += sample;
		sumSquares += sample * sample;
	}
	let avg = sum / f32(SAMPLES_PER_ITERATION);
	let variance = sumSquares / f32(SAMPLES_PER_ITERATION) - avg * avg;

	return vec4f(avg, (variance.x + variance.y + variance.z) / 3.0);
}

@fragment
fn fs(fragData: FragmentIn) -> @location(0) vec4f {
	// 格子と入力参照に同じ中央原点の座標を使う。
	let position = fragData.uv;

	// number of space divisions
	var divs = uniforms.minDivisions;

	// the center of the active quad - we initialze with 2 divisions
	var quadCenter = (floor(position * divs) + 0.5) / divs;
	var quadSize = 1.0 / divs; // the length of a side of the active quad
	
	// we store average and variance here
	var quadInfos = vec4f(0.0);
	
	for (var i = 0u; i < uniforms.maxIterations; i++) {
		quadInfos = quadColorVariation(quadCenter, quadSize);
			
		// if the variance is lower than the u_threshold, current quad is outputted
		if (quadInfos.w < uniforms.threshold) { break; }
			
		// otherwise, we divide the space again
		divs *= 2.0;
		quadCenter = (floor(position * divs) + 0.5) / divs;
		quadSize /= 2.0;
	}

	var color = read_input(fragData.uv);
	
	// the coordinates of the quad
	let nUv = fract(position * divs);
	
	// we create lines from the uv coordinates
	let lineWidth = uniforms.borderWidth * 0.5 * select(1.0, divs, uniforms.borderAbsolute != 0u);
	let uvAbs = abs(nUv - 0.5);
	let s = step(0.5 - uvAbs.x, lineWidth) + step(0.5 - uvAbs.y, lineWidth);
	
	// we smooth the color between average and texture initial
	color = vec4f(quadInfos.rgb, color.a);
		
	// for black lines, we just subtract
	if (uniforms.borderWidth > 0.0) {
		color -= s;
	}

	// Output to screen
	return color;
}
