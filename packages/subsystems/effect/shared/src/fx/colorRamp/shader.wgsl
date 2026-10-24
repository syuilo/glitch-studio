struct Settings { count: u32, interpolation: u32, colorSpace: u32, padding: u32 };
struct Stop { position: vec4f, color: vec4f, srgbColor: vec4f };
@group(0) @binding(0) var<uniform> settings: Settings;
@group(0) @binding(1) var<storage, read> stops: array<Stop>;

fn encodeSrgb(value: vec3f) -> vec3f {
	let magnitude = abs(value);
	return select(sign(value) * (1.055 * pow(magnitude, vec3f(1.0 / 2.4)) - 0.055), value * 12.92, magnitude <= vec3f(0.0031308));
}

fn outputColor(color: vec4f) -> vec4f {
	if (color.a <= 0.0) { return vec4f(0.0); }
	// 非線形の色空間変換は未乗算で行う。変換前後にalphaを戻さないと半透明色が暗くなる。
	var rgb = color.rgb / color.a;
	if (settings.colorSpace == 2u) {
		let lmsRoot = vec3f(rgb.x + 0.3963377774 * rgb.y + 0.2158037573 * rgb.z,
			rgb.x - 0.1055613458 * rgb.y - 0.0638541728 * rgb.z,
			rgb.x - 0.0894841775 * rgb.y - 1.291485548 * rgb.z);
		let lms = lmsRoot * lmsRoot * lmsRoot;
		rgb = vec3f(dot(vec3f(4.0767416621, -3.3077115913, 0.2309699292), lms),
			dot(vec3f(-1.2684380046, 2.6097574011, -0.3413193965), lms),
			dot(vec3f(-0.0041960863, -0.7034186147, 1.707614701), lms));
	}
	if (settings.colorSpace != 0u) { rgb = encodeSrgb(rgb); }
	// 初版のgamut処理は単純clamp。UIプレビューも同じ規則で生成する。
	return vec4f(clamp(rgb, vec3f(0.0), vec3f(1.0)) * color.a, color.a);
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let value = read_input(position);
	// NaNも先頭へ寄せる。入力テクスチャの不正な値を添字に使わない。
	if (!(value >= stops[0].position.x)) { return stops[0].srgbColor; }
	var lower = 0u;
	var upper = settings.count;
	// upper_boundで同位置の最後のstopを採用し、幅0の区間への除算を避ける。
	loop {
		if (lower >= upper) { break; }
		let middle = lower + (upper - lower) / 2u;
		if (stops[middle].position.x <= value) { lower = middle + 1u; } else { upper = middle; }
	}
	let left = stops[lower - 1u];
	if (lower == settings.count || value == left.position.x || settings.interpolation == 0u) { return left.srgbColor; }
	let right = stops[lower];
	var amount = (value - left.position.x) / (right.position.x - left.position.x);
	if (settings.interpolation == 2u) { amount = amount * amount * (3.0 - 2.0 * amount); }
	return outputColor(mix(left.color, right.color, amount));
}
