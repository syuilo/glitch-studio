/** 外部エンジンを起動・終了せず、ユーザーが接続したローカルHTTP APIだけを扱う。 */
export class VoicevoxClient {
	constructor(fetcher = fetch) { this.fetch = fetcher; this.endpoint = 'http://127.0.0.1:50021'; }

	async request(path, init = {}, endpoint = this.endpoint) {
		const response = await this.fetch(endpoint + path, { ...init, redirect: 'error', signal: AbortSignal.timeout(120000) });
		if (!response.ok) throw new Error(`VOICEVOX ${path.split('?')[0]}: HTTP ${response.status}`);
		return response;
	}

	async connect(endpoint) {
		const url = new URL(endpoint);
		if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Enter a local VOICEVOX URL, e.g. http://127.0.0.1:50021');
		const origin = url.origin;
		const version = await (await this.request('/version', {}, origin)).json();
		const speakers = await (await this.request('/speakers', {}, origin)).json();
		this.endpoint = origin;
		return { version, speakers };
	}

	async synthesize(request) {
		if (typeof request?.text !== 'string' || !request.text.trim() || !Number.isSafeInteger(request.styleId) || request.styleId < 0 || !Number.isFinite(request.speedScale) || request.speedScale < 0.5 || request.speedScale > 2) throw new Error('Invalid VOICEVOX request');
		// 接続先の変更中でも、一つの生成内で解析と合成に別エンジンを使わない。
		const endpoint = this.endpoint;
		const version = await (await this.request('/version', {}, endpoint)).json();
		const params = new URLSearchParams({ text: request.text, speaker: String(request.styleId) });
		const audioQuery = await (await this.request(`/audio_query?${params}`, { method: 'POST' }, endpoint)).json();
		audioQuery.speedScale = request.speedScale;
		audioQuery.outputSamplingRate = 48000;
		const response = await this.request(`/synthesis?speaker=${request.styleId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(audioQuery) }, endpoint);
		return { data: new Uint8Array(await response.arrayBuffer()), engineVersion: version, audioQuery };
	}
}

export function registerVoicevoxIpc(ipcMain, trust, client = new VoicevoxClient()) {
	ipcMain.handle('desktop:voicevox-connect', (event, endpoint) => { trust(event); return client.connect(endpoint); });
	ipcMain.handle('desktop:voicevox-synthesize', (event, request) => { trust(event); return client.synthesize(request); });
}
