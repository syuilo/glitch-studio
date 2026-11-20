struct ColorRampEffectRepetition { mode: u32, repeatMode: u32 };
@group(1) @binding(0) var<uniform> effectRepetition: ColorRampEffectRepetition;

fn colorRampInputPosition(value: f32) -> f32 {
	if (effectRepetition.mode == 1u) {
		// fractは負値も[0, 1)へ揃える。1ちょうどは0へ戻す。
		return fract(value);
	}
	if (effectRepetition.mode == 2u) {
		// 範囲内では元の値を保ち、三角波への変換による丸め誤差を避ける。
		if (value >= 0.0 && value <= 1.0) { return value; }
		// 2を周期として後半を反転する。負値も同じ周期で往復する。
		return 1.0 - abs(fract(value * 0.5) * 2.0 - 1.0);
	}
	return clamp(value, 0.0, 1.0);
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let inputPosition = colorRampInputPosition(read_input(position));
	let repeatCount = read_repeatCount(position);
	// スカラー場の0・負値は0回として扱い、定数入力にも同じ規則を適用する。
	// NaN・Infinityも先頭へ寄せる。Wrapの右端保持を適用すると0回で終端色になるため、先に分岐する。
	if (repeatCount <= 0.0 || (bitcast<u32>(repeatCount) & 0x7f800000u) == 0x7f800000u) {
		return evaluateColorRamp(0.0);
	}
	// 入力範囲の処理 → エフェクト側の繰り返し → データ側の繰り返し・補間。
	// 回数を掛け合わせると、小数回やPing-pongで「完成した配色全体を繰り返す」意味が失われる。
	let repeatedPosition = colorRampRepeatPosition(inputPosition, repeatCount, effectRepetition.repeatMode);
	return evaluateColorRamp(repeatedPosition);
}
