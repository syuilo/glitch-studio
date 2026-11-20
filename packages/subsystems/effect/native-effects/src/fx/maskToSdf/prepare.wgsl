override MAX_MASK_DIFFERENCE: f32 = 65504.0;

@fragment
fn prepare(frag: FragmentIn) -> @location(0) f32 {
	// 閾値に近い入力を16bitへ先に丸めると内外が反転し得るため、差を取ってから保存する。
	// 保存範囲を越える差は飽和させ、後段の境界補間へ無限大を渡さない。
	return clamp(read_input(frag.position) - uniforms.threshold, -MAX_MASK_DIFFERENCE, MAX_MASK_DIFFERENCE);
}
