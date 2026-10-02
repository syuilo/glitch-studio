export type Asset = {
	id: string;
	name: string;
	width: number;
	height: number;
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

// 画像の中間処理でフィルタリング・ブレンド可能なRGBA形式。
export type IntermediateTextureFormat = 'rgba8unorm' | 'bgra8unorm' | 'rgba16float';

export type WrapMode = 'clamp' | 'repeat' | 'repeatMirrored' | 'transparent';

export type FitMode = 'stretch' | 'cover' | 'contain';
