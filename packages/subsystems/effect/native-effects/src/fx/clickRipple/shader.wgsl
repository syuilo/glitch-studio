struct Ripple {
	center: vec2f,
	radius: f32,
	fade: f32,
};

struct Uniforms {
	ripples: array<Ripple, 16>,
	halfExtent: vec2f,
	wavelength: f32,
	width: f32,
	strength: f32,
	rippleCount: u32,
};

@group(0) @binding(0) var<uniform> params: Uniforms;

struct RippleOutputs {
	@location(0) displacement: vec2f,
	@location(1) mask: f32,
};

@fragment
fn fs(@location(0) position: vec2f) -> RippleOutputs {
	let point = position * params.halfExtent;
	var displacement = vec2f(0.0);
	var mask = 0.0;
	for (var index = 0u; index < params.rippleCount; index++) {
		let ripple = params.ripples[index];
		let offset = point - ripple.center;
		let distanceFromCenter = length(offset);
		let distanceBehindFront = ripple.radius - distanceFromCenter;
		if (distanceBehindFront <= 0.0 || distanceBehindFront >= params.width) {
			continue;
		}

		// 進行方向の前後で振幅を滑らかにゼロへ落とし、有限幅の帯だけを動かす。
		let envelope = smoothstep(0.0, 0.18 * params.width, distanceBehindFront)
			* (1.0 - smoothstep(0.55 * params.width, params.width, distanceBehindFront));
		let wave = sin(6.2831853 * distanceBehindFront / params.wavelength) * envelope * ripple.fade;
		// 中心で方向が不定でも変位が連続になるように、中心近傍だけ方向ベクトルの長さを落とす。
		let direction = offset / max(distanceFromCenter, 0.25 * params.wavelength);
		displacement += direction * (wave * params.strength);
		mask = max(mask, wave);
	}
	return RippleOutputs(displacement, mask);
}
