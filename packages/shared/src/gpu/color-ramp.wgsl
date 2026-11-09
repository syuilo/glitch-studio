struct ColorRampSettings { count: u32, interpolation: u32, colorSpace: u32, padding: u32 };
struct ColorRampStop { position: vec4f, color: vec4f, linearColor: vec4f };
@group(__COLOR_RAMP_GROUP__) @binding(0) var<uniform> colorRampSettings: ColorRampSettings;
@group(__COLOR_RAMP_GROUP__) @binding(1) var<storage, read> colorRampStops: array<ColorRampStop>;

fn decodeColorRampSrgb(value: vec3f) -> vec3f {
	let magnitude = abs(value);
	return sign(value) * select(magnitude / 12.92, pow((magnitude + 0.055) / 1.055, vec3f(2.4)), magnitude > vec3f(0.04045));
}

fn colorRampOutputColor(color: vec4f) -> vec4f {
	if (color.a <= 0.0) { return vec4f(0.0); }
	// 非線形の色空間変換は未乗算で行う。変換前後にalphaを戻さないと半透明色が暗くなる。
	var rgb = vec3f(color.rg / color.a, color.b);
	if (colorRampSettings.colorSpace == 3u) {
		// OKLCHの色相にはalphaを乗算しない。L・Cだけを未乗算へ戻し、Labへ変換する。
		let angle = color.b * 6.283185307179586;
		rgb = vec3f(rgb.x, rgb.y * cos(angle), rgb.y * sin(angle));
	} else {
		rgb.b /= color.a;
	}
	if (colorRampSettings.colorSpace == 2u || colorRampSettings.colorSpace == 3u) {
		rgb = oklabToLinearSrgb(rgb);
	}
	if (colorRampSettings.colorSpace == 0u) { rgb = decodeColorRampSrgb(rgb); }
	// 補間空間だけを選択し、ノード間の作業空間はlinear sRGBへ固定する。色域外も保持する。
	return vec4f(rgb * color.a, color.a);
}

// 戻り値は乗算済みlinear sRGB。呼び出し側でalphaを再乗算しない。
fn evaluateColorRamp(value: f32) -> vec4f {
	// NaNも先頭へ寄せる。入力テクスチャの不正な値を添字に使わない。
	if (!(value >= colorRampStops[0].position.x)) { return colorRampStops[0].linearColor; }
	var lower = 0u;
	var upper = colorRampSettings.count;
	// upper_boundで同位置の最後のstopを採用し、幅0の区間への除算を避ける。
	loop {
		if (lower >= upper) { break; }
		let middle = lower + (upper - lower) / 2u;
		if (colorRampStops[middle].position.x <= value) { lower = middle + 1u; } else { upper = middle; }
	}
	let left = colorRampStops[lower - 1u];
	if (lower == colorRampSettings.count || value == left.position.x || colorRampSettings.interpolation == 0u) { return left.linearColor; }
	let right = colorRampStops[lower];
	var amount = (value - left.position.x) / (right.position.x - left.position.x);
	if (colorRampSettings.interpolation == 2u) {
		amount = amount * amount * (3.0 - 2.0 * amount);
	} else if (colorRampSettings.interpolation == 3u) {
		// CPUと同じ5次式。端点で1階・2階微分を0にし、stop付近の変化を緩やかにする。
		amount = amount * amount * amount * (amount * (amount * 6.0 - 15.0) + 10.0);
	} else if (colorRampSettings.interpolation == 4u) {
		amount = amount * amount;
	} else if (colorRampSettings.interpolation == 5u) {
		amount = amount * (2.0 - amount);
	}
	var color = mix(left.color, right.color, amount);
	if (colorRampSettings.colorSpace == 3u) {
		// 無彩色の色相補完と経路の展開はCPUで済ませ、区間内では線形補間だけを行う。
		color.b = mix(left.position.y, left.position.z, amount);
	}
	return colorRampOutputColor(color);
}
