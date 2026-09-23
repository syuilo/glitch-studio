// 推定用uniformの先頭にあるtexelSizeだけを共有する。
@group(0) @binding(0) var<uniform> texelSize: vec2f;

@fragment
fn capture(@location(0) position: vec2f) -> @location(0) f32 {
	var luminance = 0.0;
	// 履歴1画素の中心から±1/4画素で4点平均する。[-1, 1]座標ではUVの2倍、Yは上向き。
	// nearestでも各点の取得後の平均は残し、入力の補間と縮小用の前処理を分ける。
	for (var y = -1; y <= 1; y += 2) {
		for (var x = -1; x <= 1; x += 2) {
			let offset = vec2f(f32(x), -f32(y)) * texelSize * 0.5;
			let color = read_input(position + offset);
			// 乗算済みRGBは既に黒背景上の色なので、alphaを再度掛けない。
			luminance += clamp(dot(color.rgb, vec3f(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
		}
	}
	return luminance * 0.25;
}
