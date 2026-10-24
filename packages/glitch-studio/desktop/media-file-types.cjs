// OSへ公開する形式と、起動要求として受け入れる形式を一致させる。
// コンテナが対応していても、内部のコーデックによってはデコードできない場合がある。
module.exports = [
	{ ext: ['png'], type: 'image/png' },
	{ ext: ['jpg', 'jpeg'], type: 'image/jpeg' },
	{ ext: ['gif'], type: 'image/gif' },
	{ ext: ['webp'], type: 'image/webp' },
	{ ext: ['avif'], type: 'image/avif' },
	{ ext: ['bmp'], type: 'image/bmp' },
	{ ext: ['mp4', 'm4v'], type: 'video/mp4' },
	{ ext: ['mov'], type: 'video/quicktime' },
	{ ext: ['webm'], type: 'video/webm' },
	{ ext: ['mkv'], type: 'video/x-matroska' },
];
