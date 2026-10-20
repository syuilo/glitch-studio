import { pathToFileURL } from 'node:url';
import { resolveAppPath } from './protocol-path.mjs';

/** アプリ本体と外部参照素材を、それぞれのオリジン・読み込み条件で配信する。 */
export function createAppProtocolHandler({ uiRoot, entryUrl, externalAssetFiles, fetchFile }) {
	const entry = new URL(entryUrl);
	// NodeのURL.originは独自schemeをnullにするため、登録済みのstandard originを組み立てる。
	const entryOrigin = `${entry.protocol}//${entry.host}`;
	return async request => {
		try {
			if (new URL(request.url).host === 'external-assets') {
				return externalAssetFiles.respond(request, entryOrigin);
			}
			const filePath = resolveAppPath(request.url, uiRoot);
			if (filePath == null) return new Response('Forbidden', { status: 403 });
			const response = await fetchFile(pathToFileURL(filePath).href);
			const headers = new Headers(response.headers);
			// performance.now()の精度を高める。HTMLだけでなくWorkerのスクリプトにも
			// COEPが必要なので、アプリの静的ファイルすべてに同じポリシーを付ける。
			headers.set('Cross-Origin-Opener-Policy', 'same-origin');
			headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
			return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
		} catch {
			return new Response('Not found', { status: 404 });
		}
	};
}
