@fragment
fn fs(@location(0) position: vec2f) -> @location(0) SelectedValue {
	let selection = read_selection(position);
	let lower = u32(selection.x);
	let amount = selection.y;
	if (amount == 1.0) { return read_inputs(lower + 1u, position); }
	let first = read_inputs(lower, position);
	if (amount == 0.0) { return first; }
	return mix(first, read_inputs(lower + 1u, position), amount);
}
