// Liquid Metal by Paper Design, Apache-2.0 (see LICENSE).
// https://github.com/paper-design/shaders/blob/main/packages/shaders/src/shaders/liquid-metal.ts
// Modified: GLSL -> WGSL, node-only mask, GPU preprocessing, premultiplied output.
// Fluid motion imitation applied over user image with animated stripe pattern
// getting distorted along shape edges.
struct Uniforms {
	colorBack: vec4f, // Background color in RGBA
	colorTint: vec4f, // Overlay color in RGBA (color burn blending used)
	resolution: vec2f,
	time: f32,
	repetition: f32, // Density of pattern stripes (1 to 10)
	softness: f32, // Color transition sharpness: 0 = hard edge, 1 = smooth gradient
	shiftRed: f32, // R-channel dispersion (-1 to 1)
	shiftBlue: f32, // B-channel dispersion (-1 to 1)
	distortion: f32, // Noise distortion over the stripes pattern (0 to 1)
	contour: f32, // Strength of the distortion on the shape edges (0 to 1)
	angle: f32, // Direction of pattern animation in half turns (-1 to +1)
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var sourceSampler: sampler;
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(3) var edgeTexture: texture_2d<f32>;

struct FragmentIn {
	@builtin(position) position: vec4f,
	@location(0) uv: vec2f,
};
const PI = 3.14159265358979323846;

fn rotate(uv: vec2f, th: f32) -> vec2f {
	return mat2x2f(cos(th), sin(th), -sin(th), cos(th)) * uv;
}

fn imageUV(position: vec2f) -> vec2f {
	var uv = position * 0.5;
	uv += vec2f(0.5);
	return vec2f(uv.x, 1.0 - uv.y);
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

fn getColorChanges(c1: f32, c2: f32, stripe_p: f32, w: vec3f, blur: f32, rawBump: f32, tint: f32) -> f32 {

  var ch = mix(c2, c1, smoothstep(0.0, 2.0 * blur, stripe_p));

  var border = w[0];
  ch = mix(ch, c2, smoothstep(border, border + 2.0 * blur, stripe_p));

  let bump = smoothstep(0.2, 0.8, rawBump);
  border = w[0] + 0.4 * (1.0 - bump) * w[1];
  ch = mix(ch, c1, smoothstep(border, border + 2.0 * blur, stripe_p));

  border = w[0] + 0.5 * (1.0 - bump) * w[1];
  ch = mix(ch, c2, smoothstep(border, border + 2.0 * blur, stripe_p));

  border = w[0] + w[1];
  ch = mix(ch, c1, smoothstep(border, border + 2.0 * blur, stripe_p));

  var gradient_t = (stripe_p - w[0] - w[1]) / w[2];
  var gradient = mix(c1, c2, smoothstep(0.0, 1.0, gradient_t));
  ch = mix(ch, gradient, smoothstep(border, border + 0.5 * blur, stripe_p));

  // Tint color is applied with color burn blending
  ch = mix(ch, 1.0 - min(1.0, (1.0 - ch) / max(tint, 0.0001)), uniforms.colorTint.a);
  return ch;
}

fn blurEdge3x3(uv: vec2f, radius: f32, centerSample: f32) -> f32 {
  var texel = 1.0 / vec2f(textureDimensions(sourceTexture));
  var r = radius * texel;

  let w1 = 1.0;
  let w2 = 2.0;
  let w4 = 4.0;
  var norm = 16.0;
  var sum = w4 * centerSample;

  sum += w2 * textureSampleLevel(edgeTexture, sourceSampler, uv + vec2f(0.0, -r.y), 0.0).r;
  sum += w2 * textureSampleLevel(edgeTexture, sourceSampler, uv + vec2f(0.0, r.y), 0.0).r;
  sum += w2 * textureSampleLevel(edgeTexture, sourceSampler, uv + vec2f(-r.x, 0.0), 0.0).r;
  sum += w2 * textureSampleLevel(edgeTexture, sourceSampler, uv + vec2f(r.x, 0.0), 0.0).r;

  sum += w1 * textureSampleLevel(edgeTexture, sourceSampler, uv + vec2f(-r.x, -r.y), 0.0).r;
  sum += w1 * textureSampleLevel(edgeTexture, sourceSampler, uv + vec2f(r.x, -r.y), 0.0).r;
  sum += w1 * textureSampleLevel(edgeTexture, sourceSampler, uv + vec2f(-r.x, r.y), 0.0).r;
  sum += w1 * textureSampleLevel(edgeTexture, sourceSampler, uv + vec2f(r.x, r.y), 0.0).r;

  return sum / norm;
}

@fragment
fn fs(frag: FragmentIn) -> @location(0) vec4f {

  let firstFrameOffset = 2.8;
  var t = 0.3 * (uniforms.time + firstFrameOffset);

  var uv = imageUV(frag.uv);
  var cycleWidth = uniforms.repetition;
  var edge = 0.0;

  var rotatedUV = uv - vec2f(0.5);
  var angle = (-uniforms.angle + 70.0 / 180.0) * PI;
  var cosA = cos(angle);
  var sinA = sin(angle);
  rotatedUV = vec2f(
  rotatedUV.x * cosA - rotatedUV.y * sinA,
  rotatedUV.x * sinA + rotatedUV.y * cosA
  ) + vec2f(0.5);

  // uniforms.contour is applied in 2 separate ranges:
  // - 0 to 0.4 sets the edge hardness, saturated above 0.4
  // - 0.5 to 1 warps the stripes direction along the edges, inactive below 0.5 (see uniforms.contour range 2)
  var edgeRaw = textureSampleLevel(edgeTexture, sourceSampler, uv, 0.0).r;
  edge = blurEdge3x3(uv, 6.0, edgeRaw);
  edge = pow(edge, 1.6);
  edge *= smoothstep(0.0, 0.4, uniforms.contour);
  // Re-apply edges from original resolution with anti-aliasing.
  var opacity = textureSampleLevel(sourceTexture, sourceSampler, uv, 0.0).a;
  opacity *= select(0.0, 1.0, all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0)));

  var diagBLtoTR = rotatedUV.x - rotatedUV.y;
  var diagTLtoBR = rotatedUV.x + rotatedUV.y;

  var color = vec3f(0.0);
  var color1 = vec3f(0.98, 0.98, 1.0);
  var color2 = vec3f(0.1, 0.1, 0.1 + 0.1 * smoothstep(0.7, 1.3, diagTLtoBR));

  var grad_uv = uv - vec2f(0.5);

  var dist = length(grad_uv + vec2f(0.0, 0.2 * diagBLtoTR));
  grad_uv = rotate(grad_uv, (0.25 - 0.2 * diagBLtoTR) * PI);
  var direction = grad_uv.x;

  var bump = pow(1.8 * dist, 1.2);
  bump = 1.0 - bump;
  bump *= pow(max(uv.y, 0.0), 0.3);


  var thin_strip_1_ratio = 0.12 / cycleWidth * (1.0 - 0.4 * bump);
  var thin_strip_2_ratio = 0.07 / cycleWidth * (1.0 + 0.4 * bump);
  var wide_strip_ratio = (1.0 - thin_strip_1_ratio - thin_strip_2_ratio);

  var thin_strip_1_width = cycleWidth * thin_strip_1_ratio;
  var thin_strip_2_width = cycleWidth * thin_strip_2_ratio;

  var noise = snoise(uv - vec2f(t));

  edge += (1.0 - edge) * uniforms.distortion * noise;

  direction += diagBLtoTR;
  direction -= 2.0 * noise * diagBLtoTR * (smoothstep(0.0, 1.0, edge) * (1.0 - smoothstep(0.0, 1.0, edge)));
  // uniforms.contour range 2
  direction *= mix(1.0, 1.0 - edge, smoothstep(0.5, 1.0, uniforms.contour));
  direction -= 1.7 * edge * smoothstep(0.5, 1.0, uniforms.contour);
  direction += 0.2 * pow(uniforms.contour, 4.0) * (1.0 - smoothstep(0.0, 1.0, edge));

  bump *= clamp(pow(max(uv.y, 0.0), 0.1), 0.3, 1.0);
  direction *= (0.1 + (1.1 - edge) * bump);

  direction *= (0.4 + 0.6 * (1.0 - smoothstep(0.5, 1.0, edge)));
  direction += 0.18 * (smoothstep(0.1, 0.2, uv.y) * (1.0 - smoothstep(0.2, 0.4, uv.y)));
  direction += 0.03 * (smoothstep(0.1, 0.2, 1.0 - uv.y) * (1.0 - smoothstep(0.2, 0.4, 1.0 - uv.y)));

  direction *= (0.5 + 0.5 * pow(max(uv.y, 0.0), 2.0));
  direction *= cycleWidth;
  direction -= t;


  var colorDispersion = (1.0 - bump);
  colorDispersion = clamp(colorDispersion, 0.0, 1.0);
  var dispersionRed = colorDispersion;
  dispersionRed += 0.03 * bump * noise;
  dispersionRed += 5.0 * (smoothstep(-0.1, 0.2, uv.y) * (1.0 - smoothstep(0.1, 0.5, uv.y))) * (smoothstep(0.4, 0.6, bump) * (1.0 - smoothstep(0.4, 1.0, bump)));
  dispersionRed -= diagBLtoTR;

  var dispersionBlue = colorDispersion;
  dispersionBlue *= 1.3;
  dispersionBlue += (smoothstep(0.0, 0.4, uv.y) * (1.0 - smoothstep(0.1, 0.8, uv.y))) * (smoothstep(0.4, 0.6, bump) * (1.0 - smoothstep(0.4, 0.8, bump)));
  dispersionBlue -= 0.2 * edge;

  dispersionRed *= (uniforms.shiftRed / 20.0);
  dispersionBlue *= (uniforms.shiftBlue / 20.0);

  var blur = 0.0;
  var rExtraBlur = 0.0;
  var gExtraBlur = 0.0;
  {
    var softness = 0.05 * uniforms.softness;
    blur = softness + 0.5 * smoothstep(1.0, 10.0, uniforms.repetition) * smoothstep(0.0, 1.0, edge);
    var smallCanvasT = 1.0 - smoothstep(100.0, 500.0, min(uniforms.resolution.x, uniforms.resolution.y));
    blur += smallCanvasT * smoothstep(0.0, 1.0, edge);
    rExtraBlur = softness * (0.05 + 0.1 * (uniforms.shiftRed / 20.0) * bump);
    gExtraBlur = softness * 0.05 / max(0.001, abs(1.0 - diagBLtoTR));
  }

  var w = vec3f(thin_strip_1_width, thin_strip_2_width, wide_strip_ratio);
  w[1] -= 0.02 * smoothstep(0.0, 1.0, edge + bump);
  var stripe_r = fract(direction + dispersionRed);
  var r = getColorChanges(color1.r, color2.r, stripe_r, w, blur + fwidth(stripe_r) + rExtraBlur, bump, uniforms.colorTint.r);
  var stripe_g = fract(direction);
  var g = getColorChanges(color1.g, color2.g, stripe_g, w, blur + fwidth(stripe_g) + gExtraBlur, bump, uniforms.colorTint.g);
  var stripe_b = fract(direction - dispersionBlue);
  var b = getColorChanges(color1.b, color2.b, stripe_b, w, blur + fwidth(stripe_b), bump, uniforms.colorTint.b);

  color = vec3f(r, g, b);
  color *= opacity;

  var bgColor = uniforms.colorBack.rgb * uniforms.colorBack.a;
  color = color + bgColor * (1.0 - opacity);
  opacity = opacity + uniforms.colorBack.a * (1.0 - opacity);

  // Dither the visible surface without introducing RGB into transparent pixels.
  color += vec3f(1.0 / 256.0 * (fract(sin(dot(0.014 * frag.position.xy, vec2f(12.9898, 78.233))) * 43758.5453123) - 0.5) * opacity);

  return vec4f(color, opacity);
}
