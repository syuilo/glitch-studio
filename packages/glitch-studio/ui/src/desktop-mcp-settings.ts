import { ref, shallowRef } from 'vue';
import type { McpServerSettings, McpServerState } from '@gs/glitch-studio_shared/mcp.ts';

type DesktopMcpSettingsApi = Pick<NonNullable<Window['desktop']>,
	'getMcpServerState' | 'setMcpServerSettings' | 'regenerateMcpServerToken' | 'onMcpServerStateChanged'>;

/** mainが所有する設定・稼働状態を表示する。環境設定のlocalStorageへ複製しない。 */
export class DesktopMcpSettings {
	readonly state = shallowRef<McpServerState | null>(null);
	readonly busy = ref(false);
	readonly error = ref<string | null>(null);
	private unsubscribe: (() => void) | null = null;
	private disposed = false;

	constructor(private readonly api: DesktopMcpSettingsApi) {}

	private accept(state: McpServerState): void {
		// 設定要求や初回取得の応答待ちの間にも、他ウィンドウの操作・実行履歴が届く。
		// 古い応答で稼働状態や再発行したトークンを巻き戻さない。
		if (!this.disposed && (this.state.value == null || state.revision > this.state.value.revision)) this.state.value = state;
	}

	async connect(): Promise<void> {
		if (this.disposed || this.unsubscribe != null) return;
		this.unsubscribe = this.api.onMcpServerStateChanged(state => this.accept(state));
		await this.perform(() => this.api.getMcpServerState());
	}

	private async perform(operation: () => Promise<McpServerState>): Promise<void> {
		if (this.disposed || this.busy.value) return;
		this.busy.value = true;
		this.error.value = null;
		try {
			this.accept(await operation());
		} catch (error) {
			if (!this.disposed) this.error.value = error instanceof Error ? error.message : String(error);
		} finally {
			this.busy.value = false;
		}
	}

	async update(patch: Partial<McpServerSettings>): Promise<void> {
		if (this.state.value == null) return;
		const settings = { ...this.state.value.settings, ...patch };
		await this.perform(() => this.api.setMcpServerSettings(settings));
	}

	async regenerateToken(): Promise<void> {
		await this.perform(() => this.api.regenerateMcpServerToken());
	}

	dispose(): void {
		this.disposed = true;
		this.unsubscribe?.();
		this.unsubscribe = null;
	}
}

/** 設定ファイルとして貼り付ける内容を返す。ユーザーがコピーするまで外部へ送らない。 */
export function createMcpClientConfiguration(client: 'codex' | 'claude', state: Pick<McpServerState, 'url' | 'token'>): string {
	if (client === 'codex') {
		return `[mcp_servers.glitch_studio]\nurl = ${JSON.stringify(state.url)}\nhttp_headers = { Authorization = ${JSON.stringify(`Bearer ${state.token}`)} }\n`;
	}
	return JSON.stringify({ mcpServers: { glitch_studio: { type: 'http', url: state.url, headers: { Authorization: `Bearer ${state.token}` } } } }, null, 2);
}
