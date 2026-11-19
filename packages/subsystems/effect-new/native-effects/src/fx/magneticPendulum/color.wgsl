fn pendulumColor(simulation: PendulumSimulationResult, position: vec2f) -> vec4f {
	if (simulation.magnetIndex < MAGNET_COUNT) {
		let color = read_magnetColors(simulation.magnetIndex, position);
		// 最大ステップ数で正規化せず、計算上限だけを増やしても既収束点の明るさを変えない。
		let brightness = mix(1.0, 0.15 + 0.85 * exp(-simulation.settlingTime * 0.15), uniforms.settlingShading);
		// 入力色は乗算済み。陰影ではRGBだけを暗くし、指定した透明度を保つ。
		return vec4f(color.rgb * brightness, color.a);
	}
	return read_unconvergedColor(position);
}
