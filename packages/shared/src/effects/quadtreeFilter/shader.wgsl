fn convertTexCoords(uv: vec2f) -> vec2f {
	return vec2f(uv.x, -uv.y) * 0.5 + vec2f(0.5);
}

struct Uniforms {
	minDivisions: f32,
	maxIterations: u32,
	threshold: f32,
	borderAbsolute: u32,
	borderWidth: f32,
};

@group(0) @binding(1) var<uniform> uniforms: Uniforms;
@group(0) @binding(2) var mySampler: sampler;
@group(0) @binding(3) var sourceTexture: texture_2d<f32>;

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
const F_SAMPLES_PER_ITERATION = 30.0;

// useless, kept it for reference for a personal usage 
const MAX_SAMPLES = 200;

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
	// this array will store the grayscale of the samples
	var samplesBuffer: array<vec3f, SAMPLES_PER_ITERATION>;
	
	// the average of the color components
	var avg = vec3f(0.0);
	
	// we sample the current space by picking pseudo random samples in it 
	for (var i = 0; i < SAMPLES_PER_ITERATION; i++) {
		let fi = f32(i);
		// pick a random 2d point using the center of the active quad as input
		// this ensures that for every point belonging to the active quad, we pick the same samples
		let r = hash22(center.xy + vec2f(fi, 0.0)) - 0.5;
		let sp = textureSampleLevel(sourceTexture, mySampler, center + r * size, 0.0).rgb;
		avg += sp;
		samplesBuffer[i] = sp;
	}
	
	avg /= F_SAMPLES_PER_ITERATION;
	
	// estimate the color variation on the active quad by computing the variance
	var variance = vec3f(0.0);
	for (var i = 0; i < SAMPLES_PER_ITERATION; i++) {
		variance += pow(samplesBuffer[i], vec3f(2.0));
	}
	variance /= F_SAMPLES_PER_ITERATION;
	variance -= pow(avg, vec3f(2.0));
			
	return vec4f(avg, (variance.x + variance.y + variance.z) / 3.0);
}

@fragment
fn fs(fragData: FragmentIn) -> @location(0) vec4f {
	// Normalized pixel coordinates (from 0 to 1)
	let uv = convertTexCoords(fragData.uv);

	// number of space divisions
	var divs = uniforms.minDivisions;

	// the center of the active quad - we initialze with 2 divisions
	var quadCenter = (floor(uv * divs) + 0.5) / divs;
	var quadSize = 1.0 / divs; // the length of a side of the active quad
	
	// we store average and variance here
	var quadInfos = vec4f(0.0);
	
	for (var i = 0u; i < uniforms.maxIterations; i++) {
		quadInfos = quadColorVariation(quadCenter, quadSize);
			
		// if the variance is lower than the u_threshold, current quad is outputted
		if (quadInfos.w < uniforms.threshold) { break; }
			
		// otherwise, we divide the space again
		divs *= 2.0;
		quadCenter = (floor(uv * divs) + 0.5) / divs;
		quadSize /= 2.0;
	}

	var color = textureSampleLevel(sourceTexture, mySampler, uv, 0.0);
	
	// the coordinates of the quad
	let nUv = fract(uv * divs);
	
	// we create lines from the uv coordinates
	let lWidth = select(vec2f(uniforms.borderWidth / divs / 2.0), vec2f(uniforms.borderWidth / 2.0), uniforms.borderAbsolute != 0u);
	let uvAbs = abs(nUv - 0.5);
	let s = step(0.5 - uvAbs.x, lWidth.x * divs) + step(0.5 - uvAbs.y, lWidth.y * divs);
	
	// we smooth the color between average and texture initial
	color = vec4f(quadInfos.rgb, color.a);
		
	// for black lines, we just subtract
	if (uniforms.borderWidth > 0.0) {
		color -= s;
	}

	// Output to screen
	return color;
}
