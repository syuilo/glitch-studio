export type ScriptDialogRequest =
	| { kind: 'alert' | 'confirm' | 'error'; text: string }
	| { kind: 'inputText'; text: string; defaultValue: string }
	| { kind: 'select'; text: string; items: { id: string; label: string }[]; defaultId: string | null };

export type ScriptDialogHandler = (request: ScriptDialogRequest, signal: AbortSignal) => Promise<string | boolean | null>;
