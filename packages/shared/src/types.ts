import type { FileSource } from './file-source.ts';

export type Asset = {
	id: string;
	name: string;
	width: number;
	height: number;
	fileDataType: string;
	fileData: FileSource;
	hash?: string;
};

export type Player = {
	id: string;
	name: string;
	sourceType: null | 'asset' | 'webcam' | 'microphone' | 'liveStream';
	assetId?: Asset['id'] | null;
};

// 通常の画像出力は、0〜1の範囲外も保持し、フィルタリング・ブレンド可能な16bit floatに統一する。
export const INTERMEDIATE_TEXTURE_FORMAT = 'rgba16float';

export type WrapMode = 'clamp' | 'repeat' | 'repeatMirrored' | 'transparent';

export type FitMode = 'stretch' | 'cover' | 'contain';
