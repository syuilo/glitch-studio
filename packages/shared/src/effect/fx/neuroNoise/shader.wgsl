// Neuro Noise by Paper Design, Apache-2.0 (see LICENSE and NOTICE).
// https://github.com/paper-design/shaders/blob/main/packages/shaders/src/shaders/neuro-noise.ts
// Original algorithm: https://x.com/zozuar/status/1625182758745128981/
// Modified: GLSL -> WGSL, evolving per-layer phases, ShaderInput colors/background,
// resolution-independent sizing and alpha-safe foreground dithering.

struct Uniforms {
	coordinateScale: vec2f,
	offset: vec2f,
	scale: f32,
	angle: f32,
	brightness: f32,
	contrast: f32,
	phases: array<vec4f, 15>,
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;

fn rotate(position: vec2f, angle: f32) -> vec2f {
	return mat2x2f(cos(angle), sin(angle), -sin(angle), cos(angle)) * position;
}

fn neuroShape(position: vec2f) -> f32 {
	var uv = position;
	var sineAccumulator = vec2f(0.0);
	var result = vec2f(0.0);
	var frequency = 8.0;
	for (var layer = 0u; layer < 15u; layer++) {
		uv = rotate(uv, 1.0);
		sineAccumulator = rotate(sineAccumulator, 1.0);
		// 網目を作る正弦波の累積は元のまま、層ごとの時間位相だけを差し替える。
		let phase = uv * frequency + vec2f(f32(layer)) + sineAccumulator - uniforms.phases[layer].xy;
		sineAccumulator += sin(phase);
		result += (vec2f(0.5) + 0.5 * cos(phase)) / frequency;
		frequency *= 1.2;
	}
	return result.x + result.y;
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let background = read_background(position);
	let frontColor = read_colorFront(position);
	let midColor = read_colorMid(position);
	// 元のピクセル依存の密度を、基準領域1000px相当の一定密度に置き換える。
	// 1000 * 0.01（元の頂点シェーダー）* 0.13（元のfragment）= 1.3。
	// offsetは半幅・半高さが1、Angleは1で時計回り180度というアプリの単位。
	let shapeUV = rotate((position - uniforms.offset) * uniforms.coordinateScale * 0.5, uniforms.angle) / uniforms.scale * 1.3;
	var intensity = neuroShape(shapeUV);
	intensity = (1.0 + uniforms.brightness) * intensity * intensity;
	intensity = min(1.4, pow(intensity, 0.7 + 6.0 * uniforms.contrast));
	let blend = smoothstep(0.7, 1.4, intensity);
	// 両入力とも乗算済みのため、RGBAをまとめて補間し二重乗算しない。
	let blendedColor = mix(midColor, frontColor, blend);
	let opacity = clamp(blendedColor.a * intensity, 0.0, 1.0);
	// RGBの1超えは発光表現として維持する。通常の画像形式の保存範囲に従う。
	var color = blendedColor.rgb * intensity;
	// 背景と完全透明な領域にはノイズを足さない。粒の分布も解像度から独立させる。
	let dither = (fract(sin(dot(shapeUV * 1000.0, vec2f(12.9898, 78.233))) * 43758.5453123) - 0.5) / 256.0;
	color += vec3f(dither * opacity);
	return vec4f(color, opacity) + background * (1.0 - opacity);
}
