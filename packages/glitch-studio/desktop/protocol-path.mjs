import path from 'node:path';

export function resolveAppPath(requestUrl, root) {
	const url = new URL(requestUrl);
	if (url.protocol !== 'app:' || url.host !== 'glitch-studio') return null;
	const pathname = decodeURIComponent(url.pathname);
	// Windowsの区切り文字や代替データストリームも受け付けない。
	if (pathname.includes('\\') || pathname.includes(':') || pathname.includes('\0')) return null;
	const filePath = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
	const relative = path.relative(root, filePath);
	if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return null;
	return filePath;
}
