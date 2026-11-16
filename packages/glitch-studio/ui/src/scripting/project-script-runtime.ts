import { Interpreter, Parser, Scope, errors, values } from '@syuilo/aiscript';
import type { values as AiScriptValues } from '@syuilo/aiscript';
import { dataToScriptValue, scriptObject, scriptValueToData } from './script-values.ts';
import type { ScriptData } from './script-values.ts';

export type ScriptDialogRequest = {
	kind: 'alert' | 'confirm' | 'input_text' | 'select';
	title: string;
	text: string;
	defaultValue: string | null;
	items: { id: string; label: string }[];
};

export type ProjectScriptHost = {
	commands: readonly { name: string; label: string }[];
	executeCommand(name: string, input: Record<string, ScriptData>, signal: AbortSignal): Promise<unknown>;
	queries: Record<string, (...args: any[]) => unknown>;
	dialog(request: ScriptDialogRequest, signal: AbortSignal): Promise<string | boolean | null>;
	output(value: AiScriptValues.Value): void;
};

function dialogRequest(kind: ScriptDialogRequest['kind'], input: Record<string, ScriptData>): ScriptDialogRequest {
	for (const key of ['title', 'text', 'default']) {
		if (input[key] != null && typeof input[key] !== 'string') throw new Error(`${key} must be a string`);
	}
	const items: ScriptDialogRequest['items'] = [];
	if (kind === 'select') {
		if (!Array.isArray(input.items) || input.items.length === 0) throw new Error('Select requires a nonempty items array');
		for (const entry of input.items) {
			const item = scriptObject(entry);
			if (typeof item.id !== 'string' || typeof item.label !== 'string' || items.some(existing => existing.id === item.id)) {
				throw new Error('Select items require unique string IDs and string labels');
			}
			items.push({ id: item.id, label: item.label });
		}
		if (input.default != null && !items.some(item => item.id === input.default)) throw new Error('Default selection does not exist');
	}
	return { kind, title: input.title as string ?? '', text: input.text as string ?? '', defaultValue: input.default as string ?? items[0]?.id ?? null, items };
}

/** 一回の実行だけを所有する。プロジェクト選択・履歴・画面への表示は呼び出し側が担当する。 */
export class ProjectScriptRuntime {
	private readonly lifetime = new AbortController();
	private interpreter: Interpreter | null = null;
	private exited = false;
	private disposed = false;
	private failure: unknown = null;
	private pendingHostCall: Promise<void> = Promise.resolve();

	constructor(private readonly host: ProjectScriptHost, private readonly maxSteps = 1_000_000) {}

	private fail(error: unknown): never {
		if (!this.exited && !this.disposed && this.failure == null) this.failure = error;
		this.lifetime.abort();
		this.interpreter?.abort();
		throw error;
	}

	private bind(name: string, argumentCount: number, invoke: (...args: ScriptData[]) => unknown): AiScriptValues.Value {
		return values.FN_NATIVE(async args => {
			try {
				this.lifetime.signal.throwIfAborted();
				if (args.length !== argumentCount) throw new Error(`Expected ${argumentCount} argument(s)`);
				const input = args.map(value => {
					if (value == null) throw new Error('Missing argument');
					return scriptValueToData(value);
				});
				const result = await invoke(...input);
				this.lifetime.signal.throwIfAborted();
				return dataToScriptValue(result);
			} catch (error) {
				const failure = error instanceof errors.AiScriptError ? error : new errors.AiScriptRuntimeError(error instanceof Error ? error.message : String(error));
				failure.message = `${name}: ${failure.message}`;
				return this.fail(failure);
			}
		});
	}

	private enqueueHostCall(run: () => Promise<unknown>): Promise<unknown> {
		// AiScriptの配列map等はcallbackを並行評価する。ホスト側の編集・ダイアログは
		// 呼び出し順に完了させ、同じ状態から準備した複数Commandの上書きを防ぐ。
		const pending = this.pendingHostCall.then(() => {
			this.lifetime.signal.throwIfAborted();
			return run();
		}).catch(error => {
			throw error instanceof errors.AiScriptError ? error : new errors.AiScriptRuntimeError(error instanceof Error ? error.message : String(error));
		});
		this.pendingHostCall = pending.then(() => {}, error => {
			if (!this.exited && !this.disposed && this.failure == null) this.failure = error;
			this.lifetime.abort();
			this.interpreter?.abort();
		});
		return pending;
	}

	public async run(source: string): Promise<void> {
		const constants: Record<string, AiScriptValues.Value> = {};
		for (const command of this.host.commands) {
			const name = `Command:${command.name}`;
			constants[name] = this.bind(name, 1, input => {
				const data = scriptObject(input);
				return this.enqueueHostCall(() => this.host.executeCommand(command.name, data, this.lifetime.signal));
			});
		}
		for (const [name, query] of Object.entries(this.host.queries)) constants[name] = this.bind(name, query.length, query);
		constants['Script:commands'] = this.bind('Script:commands', 0, () => this.host.commands.map(command => ({ ...command })));
		constants['Script:queries'] = this.bind('Script:queries', 0, () => Object.keys(this.host.queries));
		constants['Script:exit'] = values.FN_NATIVE(() => {
			this.exited = true;
			this.lifetime.abort();
			this.interpreter?.abort();
			throw new errors.AiScriptRuntimeError('Script finished');
		});
		for (const kind of ['alert', 'confirm', 'input_text', 'select'] as const) {
			const name = `Dialog:${kind}`;
			constants[name] = this.bind(name, 1, input => {
				const request = dialogRequest(kind, scriptObject(input));
				return this.enqueueHostCall(() => this.host.dialog(request, this.lifetime.signal));
			});
		}
		const interpreter = new Interpreter(constants, {
			maxStep: this.maxSteps,
			out: value => { if (!this.lifetime.signal.aborted) this.host.output(value); },
			log: type => {
				if (type !== 'block:enter') return;
				// AiScript 1.2.1は空のloop本体を評価する際にステップを加算せず、
				// abort後もloop自体を抜けない。ブロック開始も同じ予算に含め、
				// 空ループ・終了済みcallbackから必ず実行を抜けられるようにする。
				this.lifetime.signal.throwIfAborted();
				if (this.interpreter != null && ++this.interpreter.stepCount > this.maxSteps) throw new errors.AiScriptRuntimeError('max step exceeded');
			},
		});
		this.interpreter = interpreter;
		// 標準関数は注入した同名関数より優先されるため、実行前のスコープを組み直す。
		// 共有される標準関数オブジェクトは変更せず、ほかの式評価環境へ影響させない。
		const variables = interpreter.scope.getAll();
		for (const name of ['Async:interval', 'Async:timeout', 'Core:sleep']) {
			variables.set(name, { isMutable: false, value: values.FN_NATIVE(() => this.fail(new errors.AiScriptRuntimeError(`${name} is unavailable in project scripts`))) });
		}
		variables.set('readline', { isMutable: false, value: this.bind('readline', 1, text => {
			if (typeof text !== 'string') throw new Error('Expected a prompt string');
			return this.enqueueHostCall(() => this.host.dialog(dialogRequest('input_text', { text }), this.lifetime.signal));
		}) });
		interpreter.scope = new Scope([variables]);
		try {
			this.lifetime.signal.throwIfAborted();
			await interpreter.exec(new Parser().parse(source));
			if (this.failure != null) throw this.failure;
		} catch (error) {
			if (!this.exited && !this.disposed) throw this.failure ?? error;
		} finally {
			this.lifetime.abort();
			interpreter.abort();
			// エラーになった並行callbackが残っても、一履歴の外へ編集を漏らさない。
			await this.pendingHostCall;
			this.interpreter = null;
		}
	}

	public dispose(): void {
		this.disposed = true;
		this.lifetime.abort();
		this.interpreter?.abort();
	}
}
