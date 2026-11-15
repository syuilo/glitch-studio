import { computed, ref, shallowRef } from 'vue';
import { Interpreter, Parser, values, errors } from '@syuilo/aiscript';
import { createProjectScriptApi } from './project-script-api.ts';
import { dataToScriptValue, scriptFunction, scriptKeys, scriptObject, scriptString, scriptValueToData } from './script-values.ts';
import { formatScriptOutput } from './script-output.ts';
import type { ProjectContext } from '../Project.ts';
import type { ScriptDialogHandler } from './script-dialog-types.ts';

export type ScriptRunStatus = 'idle' | 'running' | 'succeeded' | 'exited' | 'failed';
export type ScriptOutputEntry = { kind: 'output' | 'error' | 'truncated'; text: string };
// AiScriptは通常のErrorをラップするため、正常終了の識別を保つ専用のAiScriptErrorを使う。
class ScriptExit extends errors.AiScriptError {
	constructor() { super('Script exited'); }
}

/** 本文・出力・実行環境は編集セッションの一時状態。Projectの保存状態には含めない。 */
export class ProjectScriptingController {
	public readonly source = ref('<: Project:get()');
	public readonly output = shallowRef<ScriptOutputEntry[]>([]);
	public readonly status = ref<ScriptRunStatus>('idle');
	public readonly isRunning = computed(() => this.status.value === 'running');
	private disposed = false;
	private activeRun: { interpreter: Interpreter; abortController: AbortController; finish: () => void } | null = null;
	private outputCharacters = 0;
	private outputTruncated = false;

	constructor(private readonly project: ProjectContext, private readonly showDialog: ScriptDialogHandler) {}

	public clearOutput(): void {
		this.output.value = [];
		this.outputCharacters = 0;
		this.outputTruncated = false;
	}

	private appendOutput(entry: ScriptOutputEntry): void {
		if (this.disposed) return;
		// エラーは通常出力が上限へ達していても一件を別枠で残す。
		if (entry.kind === 'output' && (this.output.value.length >= 1000 || this.outputCharacters + entry.text.length > 100000)) {
			if (!this.outputTruncated) {
				this.outputTruncated = true;
				this.output.value = [...this.output.value, { kind: 'truncated', text: '…' }];
			}
			return;
		}
		this.outputCharacters += entry.text.length;
		this.output.value = [...this.output.value, entry];
	}

	public async run(): Promise<void> {
		if (this.disposed || this.project.isDisposed) return;
		this.clearOutput();
		this.status.value = 'running';
		const abortController = new AbortController();
		const group = this.project.stateManager.beginGroup('Run script');
		let active = true;
		const ensureActive = () => {
			if (!active || this.disposed || this.project.isDisposed || abortController.signal.aborted) throw new ScriptExit();
		};
		const api = {
			...createProjectScriptApi(this.project.stateManager.state, group),
			'Dialog:alert': scriptFunction(1, 1, text => this.showDialog({ kind: 'alert', text: scriptString(text) }, abortController.signal)),
			'Dialog:confirm': scriptFunction(1, 1, text => this.showDialog({ kind: 'confirm', text: scriptString(text) }, abortController.signal)),
			'Dialog:inputText': scriptFunction(1, 2, (text, defaultValue) => this.showDialog({
				kind: 'inputText', text: scriptString(text), defaultValue: defaultValue == null ? '' : scriptString(defaultValue),
			}, abortController.signal)),
			'Dialog:select': scriptFunction(2, 3, (text, choices, defaultValue) => {
				if (!Array.isArray(choices) || choices.length === 0) throw new Error('Expected a non-empty choices array');
				const items = choices.map(choice => {
					const item = scriptObject(choice);
					scriptKeys(item, ['id', 'label']);
					return { id: scriptString(item.id), label: scriptString(item.label) };
				});
				if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('Duplicate choice ID');
				const defaultId = defaultValue == null ? null : scriptString(defaultValue);
				if (defaultId != null && !items.some(item => item.id === defaultId)) throw new Error('Default choice not found');
				return this.showDialog({ kind: 'select', text: scriptString(text), items, defaultId }, abortController.signal);
			}),
			'Script:exit': scriptFunction(0, 0, () => { throw new ScriptExit(); }),
		};
		const constants = Object.fromEntries(Object.entries(api).map(([name, definition]) => [name, values.FN_NATIVE(async args => {
			ensureActive();
			try {
				if (args.length < definition.minimumArgs || args.length > definition.maximumArgs) throw new Error('Invalid argument count');
				const result = await definition.invoke(...args.map(value => value == null ? null : scriptValueToData(value)));
				ensureActive();
				return dataToScriptValue(result);
			} catch (error) {
				if (error instanceof ScriptExit) throw error;
				throw new Error(name + ': ' + (error instanceof Error ? error.message : String(error)));
			}
		})]));
		const interpreter = new Interpreter(constants, {
			maxStep: 1000000,
			out: value => { if (active && !this.disposed) this.appendOutput({ kind: 'output', text: formatScriptOutput(value) }); },
		});
		// 標準関数はconstsより後に登録されるため、子Scopeで実行環境ごとに制限する。
		// 関数の別名参照も同じ制限を受け、AiScript全体の共有標準関数を変更しない。
		const unavailable = (name: string) => values.FN_NATIVE(() => { throw new Error(name + ' is unavailable in project scripts'); });
		interpreter.scope = interpreter.scope.createChildScope(new Map([
			['Async:interval', { isMutable: false, value: unavailable('Async:interval') }],
			['Async:timeout', { isMutable: false, value: unavailable('Async:timeout') }],
			['readline', { isMutable: false, value: constants['Dialog:inputText'] }],
		]));
		this.activeRun = { interpreter, abortController, finish: group.finish };
		let failure: string | null = null;
		try {
			const ast = new Parser().parse(this.source.value);
			await interpreter.exec(ast);
			this.status.value = 'succeeded';
		} catch (error) {
			if (error instanceof ScriptExit) this.status.value = 'exited';
			else {
				failure = error instanceof Error ? error.message : String(error);
				this.status.value = 'failed';
				this.appendOutput({ kind: 'error', text: failure.slice(0, 8000) });
			}
		} finally {
			// エラー・早期終了でも、成功済みの操作を戻せる履歴として必ず確定する。
			active = false;
			interpreter.abort();
			abortController.abort();
			group.finish();
		}
		if (failure != null && !this.disposed) {
			// エラー表示は実行終了後。ユーザーが内容を確認する前にUndo履歴を確定する。
			const errorDialogAbort = new AbortController();
			this.activeRun = { interpreter, abortController: errorDialogAbort, finish: group.finish };
			try {
				await this.showDialog({ kind: 'error', text: failure }, errorDialogAbort.signal);
			} finally {
				errorDialogAbort.abort();
			}
		}
		this.activeRun = null;
	}

	public dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.activeRun?.interpreter.abort();
		this.activeRun?.abortController.abort();
		this.activeRun?.finish();
		this.activeRun = null;
	}
}
