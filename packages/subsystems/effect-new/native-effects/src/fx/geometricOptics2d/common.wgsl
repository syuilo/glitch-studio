struct OpticalSettings {
	halfExtent: vec2f,
	pixelSize: f32,
	boundaryEpsilon: f32,
	maximumStep: f32,
	maximumSteps: u32,
	rootCount: u32,
	pathBudget: u32,
	maxInteractions: u32,
	minimumRelativePower: f32,
	exteriorIor: f32,
	lineWidth: f32,
	exposure: f32,
	accumulationScale: f32,
}
@group(0) @binding(0) var<uniform> settings: OpticalSettings;

struct OpticalObject {
	// 材質、550nmの屈折率、CauchyのB係数（µm²）、鏡の反射率。
	material: vec4f,
	// 650/550/450nmの吸収係数（共通距離の逆数）、法線差分の半径。
	absorption: vec4f,
	// 入力fitのXY倍率、transparentの有無、未使用。
	mapping: vec4f,
}
struct PrimaryRay {
	originDirection: vec4f,
	// 符号付きlinear RGBの等色応答と、非負の分光積分重み。
	response: vec4f,
	// 波長nm、光源の総パワー/Ray Samples、未使用。
	spectrum: vec4f,
}
struct OpticalSegment {
	endpoints: vec4f,
	response: vec4f,
	// 媒質の吸収係数。減衰を線分全体へ均等に掛けず、描画位置で評価する。
	attenuation: vec4f,
}
