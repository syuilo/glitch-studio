struct VertexOut {
	@builtin(position) position: vec4f,
	@location(0) uv: vec2f,
};

// draw(3)で描画領域全体を覆う。対角線を共有する2枚の三角形を使わず、
// その境界に沿って同じ2x2画素群を処理する余分なfragment実行を避ける。
const vertices = array(
	vec2f(-1.0, -1.0),
	vec2f( 3.0, -1.0),
	vec2f(-1.0,  3.0),
);

@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32) -> VertexOut {
	let pos = vertices[vertexIndex];
	var output: VertexOut;
	output.position = vec4f(pos, 0.0, 1.0);
	// 画面内で各軸[-1,+1]になる内部画像参照座標を維持する。
	// 画面外の頂点でもclampせず、そのまま補間させる必要がある。
	output.uv = pos.xy;
	return output;
}
