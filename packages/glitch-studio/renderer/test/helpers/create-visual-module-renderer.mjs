// 評価器はVisual Moduleの内部実装なので、公開コンストラクターで実際の構成を作る。
// パラメータ評価だけのテストではGPUリソースを使わず、シェーダーモジュールの作成だけ置き換える。
export function createVisualModuleRenderer(VisualModuleRenderer) {
	return new VisualModuleRenderer({
		gpuDevice: { createShaderModule: () => ({}) }, fallbackTexture: {},
		timingHelper: null, enableStats: false, enable32bitDataTextures: false,
		intermediateTextureFormat: 'rgba8unorm', resolution: { width: 640, height: 360 },
		videoFrames: new Map(), videoFrameVersions: new Map(), assetTextures: new Map(),
		audioSources: new Map(), assets: [], effectDefinitions: {}, effectImplementations: {},
		visualModule: {
			nodes: [], paramDefs: [], outputDefs: [], automationGraphs: [],
			primaryInputId: null, primaryOutputId: null,
		},
	});
}
