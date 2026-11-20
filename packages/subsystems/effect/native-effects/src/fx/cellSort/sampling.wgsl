fn mirroredInputPosition(uv: vec2f) -> vec2f {
	// 素材テクスチャの端ではなく、Fit後の描画領域を反射させる。
	// 格子やセル番号は折り返さず、解析・描画で入力を読む座標だけに適用する。
	let mirroredUv = 1.0 - abs(fract(uv * 0.5) * 2.0 - 1.0);
	return (mirroredUv * 2.0 - 1.0) * vec2f(1.0, -1.0);
}
