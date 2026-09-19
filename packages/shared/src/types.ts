export type EffectParamDataType = 'number' | 'angle' | 'range' | 'range2' | 'enum' | 'bool' | 'blendMode' | 'fitMode' | 'wrapMode' | 'signal' | 'xy' | 'wh' | 'color' | 'vector' | 'seed' | 'time' | 'image' | 'player';

export type NodeOutputReference = { nodeId: string; outputPort: string; fitMode?: string; wrapMode?: string };
export type NodeParamValue = { type: 'node' } & (NodeOutputReference | { nodeId: null; outputPort: null });

export type EffectParamValue = {
	type: 'literal';
	value: any; // TODO: literalにリネーム
} | {
	type: 'expression';
	expression: string;
} | {
	type: 'macro';
	macroId: string;
} | {
	type: 'automation';
	automationId: string | null;
} | NodeParamValue;

export type Macro = {
	id: string;
	label: string;
	name: string;
	type: EffectParamDataType;
	typeOptions: Record<string, any>;
	value: EffectParamValue;
};

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
	type: null | 'asset' | 'webcam' | 'microphone' | 'liveStream';
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
	input: { nodeId: string; outputPort: string } | { nodeId: null; outputPort: null };

	// 2D平面上でノードを配置できるようになった時のため
	pos?: { x: number; y: number };
};

export type GsGroupNode = any; // とりあえず

export type GsNode = GsEffectNode | GsGlobalInNode | GsGlobalOutNode;

export type NodeGraph = {
	id: string;
	name: string;
	nodes: GsNode[];
	paramDefs: {
		id: string;
		label: string;
		name: string;
		type: EffectParamDataType;
		typeOptions: Record<string, any>;
	}[];
};

export type NodeGraphLayer = {
	type: 'nodeGraph';
	nodeGraphId: string;
	paramValues: Record<string, EffectParamValue>;
};

export type Layer = NodeGraphLayer;

export type Timeline = {
	id: string;
	layer: Layer;
	startTimeMs: number;
	endTimeMs: number;
}[];
