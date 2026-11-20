@fragment
fn fs(@location(0) position: vec2f) -> @location(0) SelectedValue {
	let amount = read_blendWeight(position);
	let first = read_first(position);
	if (amount == 0.0) { return first; }
	return mix(first, read_second(position), amount);
}
