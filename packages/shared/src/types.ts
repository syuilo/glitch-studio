export type FxParamDataType = 'number' | 'angle' | 'range' | 'range2' | 'enum' | 'bool' | 'blendMode' | 'fitMode' | 'wrapMode' | 'signal' | 'xy' | 'wh' | 'color' | 'vector' | 'seed' | 'time' | 'image' | 'player' | 'node' | 'nodes';

export type NodeOutputReference = { nodeId: string; outputPort: string };
export type NodeParamValue = { type: 'node' } & (NodeOutputReference | { nodeId: null; outputPort: null });

export type FxParamValue = {
	type: 'literal';
	value: any; // TODO: literalにリネーム
} | {
	type: 'expression';
	expression: string;
} | {
	type: 'automation';
	automationId: string | null;
} | NodeParamValue;

export type Macro = {
	id: string;
	label: string;
	name: string;
	type: FxParamDataType;
	typeOptions: Record<string, any>;
	value: FxParamValue;
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

export type FxParamDef = Record<string, any> & {
	type: FxParamDataType;
	label: string;
	canNode?: boolean;
	default: () => FxParamValue;
	visibility?: (state: Record<string, FxParamValue>) => boolean;
};

export type FxParamDefs = Record<string, FxParamDef>;

type OmitNever<T> = { [K in keyof T as T[K] extends never ? never : K]: T[K] };

export type EvaledParams<T extends FxParamDefs> = {
	[K in keyof T]:
	T[K]['type'] extends 'node' ? NodeOutputReference | null :
	T[K]['type'] extends 'nodes' ? (NodeOutputReference | null)[] :
	T[K]['type'] extends 'image' ? string :
	T[K]['type'] extends 'player' ? string :
	T[K]['type'] extends 'range' | 'angle' ? number :
	T[K]['type'] extends 'bool' ? boolean :
	any;
};

export type InputNodeTexs<T extends FxParamDefs> = OmitNever<{
	[K in keyof T]:
	T[K]['type'] extends 'node' ? WebGLTexture :
	T[K]['type'] extends 'nodes' ? WebGLTexture[] :
	never;
}>;

export type GsKeyframe = {
	id: string;
	frame: number;
	value: number;
	bezierControlPointA: [number, number];
	bezierControlPointB: [number, number];
};

export type GsAutomation = {
	id: string;
	name: string;
	keyframes: GsKeyframe[];
};

export type GsFxNode = {
	id: string;
	type: 'fx';
	fx: string;
	isBypass: boolean;
	params: Record<string, FxParamValue>;

	// 2D平面上でノードを配置できるようになった時のため
	pos?: { x: number; y: number };
};

export type GsGroupNode = {
	id: string;
	type: 'group';
	isBypass: boolean;
	name: string;
	nodes: GsNode[];
	macros: Macro[];

	// 2D平面上でノードを配置できるようになった時のため
	pos?: { x: number; y: number };
};

export type GsNode = GsFxNode | GsGroupNode;
