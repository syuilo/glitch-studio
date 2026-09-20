export type EffectParamDataType = 'number' | 'angle' | 'range' | 'enum' | 'bool' | 'blendMode' | 'fitMode' | 'wrapMode' | 'xy' | 'wh' | 'color' | 'vector' | 'seed' | 'image' | 'player';

export type NodeOutputReference = { nodeId: string; outputPort: string; fitMode?: string; wrapMode?: string };
export type NodeParamValue = { inputSource: 'node' } & (NodeOutputReference | { nodeId: null; outputPort: null });

export type EffectParamValue = {
	inputSource: 'literal';
	value: any; // TODO: literalにリネーム？
} | {
	inputSource: 'envVariable';
	variable: string;
} | {
	inputSource: 'expression';
	expression: string;
} | {
	inputSource: 'externalParameterInput';
	parameterId: string;
} | {
	inputSource: 'automation';
	automationId: string | null;
} | NodeParamValue;

export type Asset = {
	id: string;
	name: string;
	width: number;
	height: number;
	data: Uint8Array | null;
	fileDataType: string;
	fileData: Blob;
	hash?: string;
};

export type Player = {
	id: string;
	name: string;
	sourceType: null | 'asset' | 'webcam' | 'microphone' | 'liveStream';
	assetId?: Asset['id'] | null;
};

export type EffectParamDef = Record<string, any> & {
	type: EffectParamDataType | 'struct' | 'array';
	label: string;
	canNode?: boolean;
	default: () => EffectParamValue;
	visibility?: (state: Record<string, EffectParamValue>) => boolean;
};

export type EffectParamDefs = Record<string, EffectParamDef>;

export type GsKeyframe = {
	id: string;
	timeMs: number;
	value: number;
	bezierControlPointA: [number, number];
	bezierControlPointB: [number, number];
};

export type GsAutomation = {
	id: string;
	name: string;
	keyframes: GsKeyframe[];
};

export type GsEffectNode = {
	id: string;
	type: 'effect';
	effectId: string;
	isBypass: boolean;
	params: Record<string, EffectParamValue>;

	// 2D平面上でノードを配置できるようになった時のため
	pos?: { x: number; y: number };
};

export type GsGlobalInNode = {
	id: string;
	type: 'globalIn';

	// 2D平面上でノードを配置できるようになった時のため
	pos?: { x: number; y: number };
};

export type GsGlobalOutNode = {
	id: string;
	type: 'globalOut';
	// キーはVisualModule.outputDefsのID。未設定のポートは未接続として扱う。
	inputs: Record<string, { nodeId: string; outputPort: string } | { nodeId: null; outputPort: null }>;

	// 2D平面上でノードを配置できるようになった時のため
	pos?: { x: number; y: number };
};

export type GsNode = GsEffectNode | GsGlobalInNode | GsGlobalOutNode;

export type VisualModule = {
	id: string;
	name: string;
	nodes: GsNode[];
	outputDefs: {
		id: string;
		label: string;
		name: string;
		dataType: 'color' | 'scalar' | 'vector' | 'any';
		isPrimaryOutput: boolean;
	}[];
	paramDefs: {
		id: string;
		label: string;
		name: string;
		type: EffectParamDataType;
		typeOptions: Record<string, any>;
		defaultValue: any;
		canNode: boolean;
		isPrimaryInput: boolean;
	}[];
};

// レイヤー・live modeからは、モジュール内部のノードやパラメータを参照しない。
export type VisualModuleParamValues = Record<string, Exclude<EffectParamValue, { type: 'node' | 'externalParameterInput' }>>;

export type VisualModuleLayer = {
	type: 'visualModule';
	visualModuleId: string;
	paramValues: VisualModuleParamValues;
};

export type Layer = VisualModuleLayer;

export type Timeline = {
	id: string;
	layer: Layer;
	startTimeMs: number;
	endTimeMs: number;
}[];
