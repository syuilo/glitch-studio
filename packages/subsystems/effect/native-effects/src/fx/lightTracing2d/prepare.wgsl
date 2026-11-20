struct PreparedScene {
	@location(0) color: vec4f,
	@location(1) seed: vec4f,
};

@fragment
fn prepare(frag: FragmentIn) -> PreparedScene {
	var color = read_input(frag.position);
	// 完全透明な画素にRGBが残っていても光源にはしない。乗算済み入力へαを再乗算しない。
	if (color.a <= 0.0) { color = vec4f(0.0); }
	var result: PreparedScene;
	result.color = color;
	result.seed = vec4f(-1.0);
	if (occupied(color)) { result.seed = encodeSeed(vec2i(frag.pixelPosition.xy)); }
	return result;
}
