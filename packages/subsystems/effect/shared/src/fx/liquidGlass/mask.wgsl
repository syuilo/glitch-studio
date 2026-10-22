@fragment
fn prepareMask(frag: FragmentIn) -> @location(0) f32 {
	return clamp(read_mask(frag.position), 0.0, 1.0);
}
