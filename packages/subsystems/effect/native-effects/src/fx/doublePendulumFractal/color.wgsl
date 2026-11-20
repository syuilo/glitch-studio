fn pendulumColor(state: vec4f) -> vec4f {
	if (uniforms.coloringMethod == 0u) {
		// 2つの角度を球面上の方向に対応させた元動画の配色を、8bit量子化せず連続値で扱う。
		let rgb = 0.5 + 0.5 * vec3f(sin(state.x) * cos(state.y), sin(state.x) * sin(state.y), cos(state.x));
		return vec4f(clamp(rgb, vec3f(0.0), vec3f(1.0)), 1.0);
	} else {
		var rampPosition = (state.x + PI) / TAU;
		if (uniforms.coloringMethod == 2u) { rampPosition = (state.y + PI) / TAU; }
		if (uniforms.coloringMethod == 3u) { rampPosition = 0.5 + 0.5 * state.z / uniforms.angularVelocityRange; }
		if (uniforms.coloringMethod == 4u) { rampPosition = 0.5 + 0.5 * state.w / uniforms.angularVelocityRange; }
		// Rampの端でclampし、指定した透明度を乗算済みRGBAのまま維持する。
		// 配色の範囲変更は、角度・角速度のデータ出力へは適用しない。
		return evaluateColorRamp(clamp(rampPosition, 0.0, 1.0));
	}
}
