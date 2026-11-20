struct Uniforms {
	softness: f32,
	reverse: u32,
	antiAlias: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

fn transitionMask(position: vec2f) -> f32 {
	let progress = clamp(read_progress(position), 0.0, 1.0);
	let mapValue = clamp(read_map(position), 0.0, 1.0);
	let order = select(mapValue, 1.0 - mapValue, uniforms.reverse != 0u);
	// 微分は進捗による非一様な分岐より前に評価する。定数や離散IDのMapに対して
	// 意図的な硬い切替も作れるよう、AAを独立して無効化できる。
	// Progressもscalar場を受け取るため、Mapだけでなく閾値との差を微分する。
	// 一様なProgressでは従来通りMapの勾配だけになり、定数Mapでも空間的に
	// 変化するProgressが作る輪郭にAAが効く。
	let antialiasWidth = fwidth(order - progress * (1.0 + uniforms.softness));
	let width = max(uniforms.softness, select(0.0, antialiasWidth, uniforms.antiAlias != 0u));
	if (progress <= 0.0) { return 0.0; }
	if (progress >= 1.0) { return 1.0; }
	if (width <= 0.0) { return step(order, progress); }
	// Mapの0/1にもSoftness全体を通過させる。閾値を0〜1だけ動かすと、
	// 端点近くの画素で半分だけ混ざった状態から急にA/Bへ切り替わってしまう。
	// 幅で先に割る形にして、大きなSoftnessでも閾値計算の桁落ちを抑える。
	let transitionPosition = progress + (progress - order) / width;
	return smoothstep(0.0, 1.0, transitionPosition);
}

@fragment
fn fsMask(@location(0) position: vec2f) -> @location(0) f32 {
	return transitionMask(position);
}
