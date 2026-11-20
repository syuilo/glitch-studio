fn mirroredInputPosition(uv: vec2f) -> vec2f {
	// 素材テクスチャの端ではなく、描画領域の端で反射してから接続のFitを適用する。
	// セルの範囲や番号は変えず、解析と描画で同じ反射済みの画像片を使う。
	let mirroredUv = 1.0 - abs(fract(uv * 0.5) * 2.0 - 1.0);
	return (mirroredUv * 2.0 - 1.0) * vec2f(1.0, -1.0);
}
