@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let input = read_input(position);
	// EVは光量が1段で2倍になる単位。linear RGBの倍率なので未乗算へ戻す必要はなく、
	// alpha=0の発光も同じ倍率で調整できる。alphaは被覆率として変更しない。
	return vec4f(input.rgb * exp2(read_exposure(position)), input.a);
}
