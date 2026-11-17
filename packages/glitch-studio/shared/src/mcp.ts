/** Electron内蔵MCPサーバーの設定。プロジェクトの保存内容には含めない。 */
export type McpServerSettings = {
	enabled: boolean;
	port: number;
	allowEditing: boolean;
};

export type McpActivity = {
	id: string;
	tool: string;
	startedAt: number;
	finishedAt: number | null;
	error: string | null;
};

export type McpServerState = {
	revision: number;
	settings: McpServerSettings;
	status: 'stopped' | 'starting' | 'running' | 'error';
	url: string;
	token: string;
	error: string | null;
	activity: McpActivity[];
};

/** 保存先のないプロジェクトも、編集セッションの寿命で登録する。 */
export type McpProjectSessionSummary = {
	projectSessionId: string;
	name: string;
	isActive: boolean;
	isScriptRunning: boolean;
	activeSceneId: string | null;
};

export type McpEditorOperation = 'search_scripting_api' | 'get_scripting_api' | 'execute_script' | 'capture_preview' | 'seek_timeline_and_capture';

export type McpEditorRequest = {
	requestId: string;
	operation: McpEditorOperation;
	input: Record<string, unknown>;
};

export type McpEditorResponse =
	| { requestId: string; ok: true; result: unknown }
	| { requestId: string; ok: false; error: { code: string; message: string } };

