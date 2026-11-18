import { fileURLToPath } from 'node:url';
import { loadShaderSource } from './load-shader-source.mjs';
const { ExpressionEvaluator } = await loadShaderSource(fileURLToPath(import.meta.resolve('@gs/shared/expression/expression-evaluator.ts')));

// 評価器はCustom Node Graph Effectの内部実装なので、公開コンストラクターで実際の構成を作る。
// パラメータ評価だけのテストではGPUリソースを使わず、シェーダーモジュールの作成だけ置き換える。
export function createCustomNodeGraphEffectRenderer(CustomNodeGraphEffectRenderer, options = {}) {
	return new CustomNodeGraphEffectRenderer({
		expressionEvaluator: new ExpressionEvaluator(),
		gpuDevice: { limits: { maxTextureDimension2D: 8192 }, createShaderModule: () => ({}) }, fallbackTexture: {},
		timingHelper: null, enableStats: false, enable32bitDataTextures: false,
		resolution: { width: 640, height: 360 },
		videoFrameVersions: new Map(), assetTextures: new Map(),
		assets: [], effectDefinitions: {}, effectImplementations: {},
		customNodeGraphEffect: {
			customParameterDefs: [],
			customParameterValues: {},
			nodes: [], paramDefs: [], outputDefs: [], automationGraphs: [],
			primaryInputId: null, primaryOutputId: null,
		},
		...options,
	});
}
