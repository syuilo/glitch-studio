struct FragmentIn {
	@location(0) uv: vec2f,
};

@fragment
fn capture(fragment: FragmentIn) -> @location(0) vec4f {
	// fit/wrap/filterを適用した入力をpremultiplied RGBAのまま保存する。
	return read_input(fragment.uv);
}
