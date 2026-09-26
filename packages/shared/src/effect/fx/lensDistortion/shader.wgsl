// Lens Distortion by Paper Design, Apache-2.0 (see LICENSE and NOTICE).
// https://github.com/paper-design/shaders/blob/main/packages/shaders/src/shaders/lens-distortion.ts
// Modified: GLSL -> WGSL, premultiplied ShaderInput, connection-controlled sampling,
// output-based lens geometry, vector offsets, clockwise half-turn angles, resolution-independent grain.

struct Uniforms {
	offset: vec2f,
	imageOffset: vec2f,
	aspectRatio: f32,
	angle: f32,
	rotation: f32,
	spread: f32,
	bias: f32,
	perspective: f32,
	count: u32,
	dispersion: f32,
	dispersionShift: f32,
	dispersionColor: f32,
	focusCenter: f32,
	focusEdges: f32,
	swirl: f32,
	noise: f32,
	noiseFrequency: f32,
	noiseOffset: f32,
	lensBulge: f32,
	lensCircle: f32,
	grainMixer: f32,
	grainOverlay: f32,
	scale: f32,
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
const PI = 3.141592653589793;

fn rotate(position: vec2f, angle: f32) -> vec2f {
	return mat2x2f(cos(angle), sin(angle), -sin(angle), cos(angle)) * position;
}

fn hash21(position: vec2f) -> f32 {
	var p = fract(position * vec2f(0.3183099, 0.3678794)) + vec2f(0.1);
	p += vec2f(dot(p, p + vec2f(19.19)));
	return fract(p.x * p.y);
}

fn valueNoise(position: vec2f) -> f32 {
	let cell = floor(position);
	let fraction = fract(position);
	let weight = fraction * fraction * (vec2f(3.0) - 2.0 * fraction);
	return mix(
		mix(hash21(cell), hash21(cell + vec2f(1.0, 0.0)), weight.x),
		mix(hash21(cell + vec2f(0.0, 1.0)), hash21(cell + vec2f(1.0, 1.0)), weight.x),
		weight.y,
	);
}

fn sampleOverWhite(uv: vec2f) -> vec4f {
	// 通常の接続同様、範囲外も接続のwrapで読む。元の画像枠による切り抜きは行わない。
	// 元GLSLは未乗算RGBを白とmixしていたが、入力は既に乗算済みなので白だけを足す。
	let input = read_input((uv - vec2f(0.5)) * 2.0);
	return vec4f(input.rgb + vec3f(1.0 - input.a), input.a);
}

fn hueColor(hue: f32) -> vec3f {
	// fractで負の色相もGLSLのmodと同じ0〜6へ折り返す。
	var rgb = clamp(abs(fract(vec3f(hue) + vec3f(0.0, 4.0, 2.0) / 6.0) * 6.0 - vec3f(3.0)) - vec3f(1.0), vec3f(0.0), vec3f(1.0));
	rgb = rgb * rgb * (vec3f(3.0) - 2.0 * rgb);
	return rgb;
}

struct WarpResult {
	position: vec2f,
	fade: f32,
};

fn lensWarp(position: vec2f, radius: f32, inradius: f32) -> WarpResult {
	var warped = position;
	var fade = 1.0;
	if ((uniforms.lensBulge == 0.0 && uniforms.lensCircle == 0.0) || radius < 0.00001) {
		return WarpResult(warped, fade);
	}
	var r = radius;
	if (uniforms.lensBulge != 0.0) {
		let normalizedRadius = radius / inradius;
		let bulge = abs(uniforms.lensBulge) * select(1.2, 1.4, uniforms.lensBulge > 0.0);
		var mappedRadius: f32;
		if (uniforms.lensBulge > 0.0) {
			// tanの発散直前で打ち切り、強い樽型歪みの外周をフェードさせる。
			fade = 1.0 - smoothstep(1.45, 1.53, normalizedRadius * bulge);
			mappedRadius = tan(min(normalizedRadius * bulge, 1.53)) / tan(bulge);
		} else {
			mappedRadius = atan(normalizedRadius * tan(bulge)) / bulge;
		}
		let bulgeScale = mappedRadius / normalizedRadius;
		warped *= bulgeScale;
		r *= bulgeScale;
	}
	if (uniforms.lensCircle > 0.0) {
		let direction = warped / max(r, 0.00001);
		let halfBox = vec2f(uniforms.aspectRatio, 1.0) * 0.5;
		let boxRadius = min(halfBox.x / max(abs(direction.x), 0.0001), halfBox.y / max(abs(direction.y), 0.0001));
		let band = inradius * mix(0.03, 0.2, 0.5 * (uniforms.lensBulge + 1.0));
		let innerEdge = inradius - band;
		let over = smoothstep(0.0, 1.0, (r - innerEdge) / band);
		let circleRadius = r + (boxRadius - inradius) * pow(over, 14.0);
		warped = direction * mix(r, circleRadius, uniforms.lensCircle);
	}
	return WarpResult(warped, fade);
}

struct SpreadResult {
	axis: vec2f,
	strength: f32,
};

fn getSpread(position: vec2f, radius: f32, warpedUV: vec2f, edgeAA: f32, inradius: f32, outradius: f32, reach: f32) -> SpreadResult {
	let uniformDirection = vec2f(cos(uniforms.angle), -sin(uniforms.angle));
	var radialDirection = position / inradius;
	let maxLength = (outradius + reach) / inradius;
	let radialLength = radius / inradius;
	if (radialLength > maxLength) { radialDirection *= maxLength / radialLength; }
	var spreadDirection = mix(uniformDirection, radialDirection, uniforms.perspective);
	let bandProximity = smoothstep(inradius * 0.8, inradius, radius);
	let circleStrength = bandProximity * pow(uniforms.lensCircle, 3.0);
	spreadDirection = mix(spreadDirection, radialDirection, circleStrength);
	let warpedAbs = abs(warpedUV - vec2f(0.5));
	let inner = mix(1.0, smoothstep(0.0, mix(inradius, outradius, uniforms.focusCenter), radius), uniforms.focusCenter);
	let boxDistance = max(warpedAbs.x, warpedAbs.y) * 2.0;
	let outer = mix(1.0, 1.0 - min(boxDistance, 1.0), uniforms.focusEdges);
	var strength = inner * outer;
	strength *= mix(1.0, mix(0.15, 0.03, max(-uniforms.lensBulge, 0.0)), circleStrength);
	let outside = max(warpedAbs - vec2f(0.5), vec2f(0.0));
	let margin = max(reach * length(spreadDirection) * (1.0 - uniforms.lensCircle), edgeAA);
	strength *= 1.0 - smoothstep(0.0, margin, length(outside));
	var axis = spreadDirection * (reach * strength);
	if (uniforms.noise > 0.0) {
		let turn = (valueNoise(position * uniforms.noiseFrequency * 18.0 + vec2f(uniforms.noiseOffset * 30.0)) - 0.5) * 2.0 * uniforms.noise;
		axis = rotate(axis, turn);
	}
	axis.x /= uniforms.aspectRatio;
	return SpreadResult(axis, strength);
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let aspect = vec2f(uniforms.aspectRatio, 1.0);
	// レンズ計算の距離を縦横で揃え、参照座標へ戻すときだけアスペクト補正を外す。
	// 回転は模様を時計回りに回す逆変換、offsetは画面の半幅・半高さを1とする。
	let fromCenter = rotate((position - uniforms.offset) * 0.5 * aspect, uniforms.rotation) / uniforms.scale;
	let radius = length(fromCenter);
	let inradius = 0.5 * min(uniforms.aspectRatio, 1.0);
	let outradius = 0.5 * length(aspect);
	let reach = 0.7 * pow(uniforms.spread, 1.3 + 2.7 * uniforms.spread);
	let warped = lensWarp(fromCenter, radius, inradius);
	let baseUV = warped.position / aspect + vec2f(0.5);
	let baseDerivative = fwidth(baseUV);
	let edgeAA = clamp(2.0 * max(baseDerivative.x, baseDerivative.y), 0.001, 0.02);
	let spread = getSpread(fromCenter, radius, baseUV, edgeAA, inradius, outradius, reach);
	var spreadAxis = spread.axis;
	// 元の画素依存グレインを短辺1000px相当の固定密度に置き換える。
	let grainUV = fromCenter / min(uniforms.aspectRatio, 1.0) * 800.0 + vec2f(0.5);
	if (uniforms.grainMixer > 0.0) {
		let grainSeed = valueNoise(grainUV);
		let jitter = fract(grainSeed * vec2f(157.31, 113.57)) * 2.0 - vec2f(1.0);
		spreadAxis += jitter * 0.3 * uniforms.grainMixer * length(spreadAxis);
	}
	let invCount = 1.0 / f32(uniforms.count);
	let invSpan = 1.0 / f32(uniforms.count - 1u);
	let hueBase = uniforms.dispersionColor + 0.5;
	let biasPower = 1.0 + 2.0 * abs(uniforms.bias);
	let centerAmount = clamp(1.0 - uniforms.dispersionShift, 0.0, 1.0);
	let edgesAmount = clamp(1.0 + uniforms.dispersionShift, 0.0, 1.0);
	let innerMask = 1.0 - smoothstep(0.5 * inradius, 1.1 * inradius, radius);
	let dispersion = uniforms.dispersion * mix(edgesAmount, centerAmount, innerMask);
	let dispersionPower = pow(dispersion, 0.8);
	let swirlAngle = -uniforms.swirl * 0.4 * PI * spread.strength * uniforms.spread * min(1.0, inradius / max(length(warped.position), 0.0001));
	var colorSum = vec3f(0.0);
	var weightSum = vec3f(0.0);
	var coverSum = 0.0;
	for (var i = 0u; i < uniforms.count; i++) {
		let layer = f32(i);
		let hue = hueBase + layer * invCount;
		var fraction = layer * invSpan;
		if (uniforms.bias != 0.0) {
			let mirrored = select(fraction, 1.0 - fraction, uniforms.bias < 0.0);
			let curved = pow(mirrored, biasPower);
			fraction = select(curved, 1.0 - curved, uniforms.bias < 0.0);
		}
		let fanPosition = 1.0 - 2.0 * fraction;
		var tapUV = baseUV + spreadAxis * fanPosition - vec2f(0.5);
		if (uniforms.swirl != 0.0) {
			tapUV = rotate(tapUV * aspect, swirlAngle * fanPosition) / aspect;
		}
		let tap = sampleOverWhite(tapUV + vec2f(0.5) - uniforms.imageOffset * 0.5);
		let weight = vec3f(1.0) - dispersionPower * hueColor(hue);
		colorSum += tap.rgb * weight;
		weightSum += weight;
		coverSum += tap.a;
	}
	let color = colorSum / max(weightSum, vec3f(0.0001));
	let coverAverage = coverSum * invCount;
	// 色別の重みでRGBを分離するため、平均alphaだけでは色の輪郭を表せない。
	// 元と同様に白地との差から必要なalphaを求め、白成分を引いて乗算済みへ戻す。
	let ground = min(color.r, min(color.g, color.b));
	let alpha = clamp(max(coverAverage, 1.0 - ground), 0.0, 1.0);
	let premultiplied = max(color - vec3f(1.0 - alpha), vec3f(0.0));
	var result = vec4f(premultiplied, alpha) * warped.fade;
	if (uniforms.grainOverlay > 0.0) {
		var grain = valueNoise(rotate(grainUV, 1.0) + vec2f(3.0));
		grain = mix(grain, valueNoise(rotate(grainUV, 2.0) - vec2f(1.0)), 0.5);
		let signedGrain = pow(grain, 1.3) * 2.0 - 1.0;
		let strength = pow(uniforms.grainOverlay * abs(signedGrain), 0.8) * result.a;
		result = vec4f(mix(result.rgb, vec3f(step(0.0, signedGrain) * result.a), 0.35 * strength), result.a);
	}
	return result;
}
