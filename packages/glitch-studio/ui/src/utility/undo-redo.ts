// 汎用的なUndo/Redo実装。Glitch Studioのドメイン知識を持っていてはならない。

import { computed, shallowRef, triggerRef } from 'vue';
import { deepClone } from '@gs/shared/utility/deep-clone.js';
import { deepEqual } from '@gs/shared/utility/deep-equal.ts';

export type PreparedCommandChange<State, Change> = {
	// 検証・ID生成・外部情報の取得はprepareで完了させる。apply/revertは確定した
	// 変更を同期的に反映し、Redo時にも同じ値とIDを使う。
	apply(state: State): void;
	revert(state: State): void;
	changes: readonly Change[];
	undoChanges?: readonly Change[];
};

export type PreparedCommand<State, Change, Result = void> = {
	result: Result;
	// 結果だけを返す操作もある。変更がなければ既存のRedoを破棄しない。
	change: PreparedCommandChange<State, Change> | null;
};

export type PreparedCommandDef<State, Input, Change, Result = void> = {
	label: string;
	// 同じ対象への値設定など、最後のapplyだけで最終状態を再現できる操作に限る。
	getAutoMergeKey?: (input: Input) => string | null;
	prepare(state: State, input: Input): PreparedCommand<State, Change, Result> | Promise<PreparedCommand<State, Change, Result>>;
};

export type CommandDef<State, Input, Change, Result = void> = PreparedCommandDef<State, Input, Change, Result>;

export type CommandInput<Definition> = Definition extends PreparedCommandDef<any, infer Input, any, any> ? Input : never;
export type CommandResult<Definition> = Definition extends PreparedCommandDef<any, any, any, infer Result> ? Result : void;

type CommandLog<State, Change, CommandName extends PropertyKey> = {
	type: CommandName | null;
	label: string;
	date: number;
	execute(state: State): void;
	undo(state: State): void;
	changes: readonly Change[];
	undoChanges: readonly Change[];
	mergeKey: string | null;
};

function cloneCommandData<Value>(value: Value): Value {
	return deepClone(value as never) as Value;
}

function mergeCommandChanges<Change>(earlier: readonly Change[], later: readonly Change[]): Change[] {
	// 最後のapplyだけで状態を再現できても、途中の構造変更通知は省略できない。
	// 同じ通知は後の位置へまとめ、スライダー等の連続更新回数に比例して履歴を膨らませない。
	const merged = [...earlier];
	for (const change of later) {
		const existingIndex = merged.findIndex(previous => deepEqual(previous as never, change as never));
		if (existingIndex >= 0) merged.splice(existingIndex, 1);
		merged.push(change);
	}
	return merged;
}

export class UndoRedo<State, Change, Commands extends Record<string, CommandDef<State, any, Change, any>>> {
	public state: State;
	public undoStack = shallowRef([] as CommandLog<State, Change, keyof Commands>[]);
	public redoStack = shallowRef([] as CommandLog<State, Change, keyof Commands>[]);
	public canUndo = computed(() => this.undoStack.value.length > 0);
	public canRedo = computed(() => this.redoStack.value.length > 0);
	private readonly maxUndoStackSize = 100;
	private readonly changeListeners = new Set<(changes: Change[]) => void>();
	private readonly commandDefs: Commands;
	private activeEdit: { finish(): void; cancel(): void } | null = null;
	private autoMergeCandidate: { command: CommandLog<State, Change, keyof Commands>; key: string; lastUpdatedAt: number } | null = null;
	private activeGroup: { label: string; commands: CommandLog<State, Change, keyof Commands>[] } | null = null;

	constructor(state: State, commandDefs: Commands) {
		this.state = state;
		this.commandDefs = commandDefs;
	}

	public onChange(listener: (changes: Change[]) => void): () => void {
		this.changeListeners.add(listener);
		return () => { this.changeListeners.delete(listener); };
	}

	private notify(changes: readonly Change[]): void {
		for (const listener of this.changeListeners) {
			try {
				// 購読者の変更が履歴や別の購読者へ混入しないよう、通知を切り離す。
				listener(cloneCommandData([...changes]));
			} catch (error) {
				// 描画等の購読側の失敗で適用済みの操作を履歴から失わせない。
				// 残りの購読者にも通知し、編集そのものの失敗とは区別する。
				console.error('Command change listener failed:', error);
			}
		}
	}

	private prepareCommand<Name extends keyof Commands>(type: Name, input: CommandInput<Commands[Name]>) {
		if (!Object.hasOwn(this.commandDefs, type)) throw new Error(`Unknown command: ${String(type)}`);
		const definition = this.commandDefs[type] as CommandDef<State, CommandInput<Commands[Name]>, Change, CommandResult<Commands[Name]>>;
		const savedInput = cloneCommandData(input);
		return { definition, input: savedInput, prepared: definition.prepare(this.state, savedInput) };
	}

	private createLog<Name extends keyof Commands>(type: Name, definition: { label: string }, change: PreparedCommandChange<State, Change>, mergeKey: string | null): CommandLog<State, Change, keyof Commands> {
		return {
			type,
			label: definition.label,
			date: Date.now(),
			execute: change.apply,
			undo: change.revert,
			changes: cloneCommandData([...change.changes]),
			undoChanges: cloneCommandData([...(change.undoChanges ?? change.changes)]),
			mergeKey,
		};
	}

	private pushUndo(command: CommandLog<State, Change, keyof Commands>): void {
		this.undoStack.value.push(command);
		if (this.undoStack.value.length > this.maxUndoStackSize) this.undoStack.value.shift();
		triggerRef(this.undoStack);
	}

	private record(command: CommandLog<State, Change, keyof Commands>, autoMergeKey: string | null): void {
		if (this.activeGroup != null) {
			this.activeGroup.commands.push(command);
			this.autoMergeCandidate = null;
			return;
		}
		const now = performance.now();
		const latest = this.undoStack.value.at(-1);
		const candidate = this.autoMergeCandidate;
		const canAutoMerge = candidate != null && candidate.command === latest && candidate.key === autoMergeKey
			&& now - candidate.lastUpdatedAt <= 2000;
		const canMerge = latest != null && latest.type === command.type
			&& (command.mergeKey != null ? latest.mergeKey === command.mergeKey : canAutoMerge);
		if (canMerge) {
			latest.execute = command.execute;
			latest.changes = mergeCommandChanges(latest.changes, command.changes);
			latest.undoChanges = mergeCommandChanges(command.undoChanges, latest.undoChanges);
		} else this.pushUndo(command);
		this.autoMergeCandidate = autoMergeKey == null ? null : { command: canMerge ? latest : command, key: autoMergeKey, lastUpdatedAt: now };
		this.redoStack.value = [];
	}

	private applyPrepared<Name extends keyof Commands>(type: Name, definition: { label: string; getAutoMergeKey?: (input: CommandInput<Commands[Name]>) => string | null }, input: CommandInput<Commands[Name]>, prepared: PreparedCommand<State, Change, CommandResult<Commands[Name]>>, mergeKey: string | null): CommandResult<Commands[Name]> {
		// 結果の切り離しで失敗しても、状態を変更しない。
		const result = cloneCommandData(prepared.result);
		if (prepared.change == null) return result;
		const autoMergeKey = mergeKey == null ? definition.getAutoMergeKey?.(input) ?? null : null;
		const command = this.createLog(type, definition, prepared.change, mergeKey);
		prepared.change.apply(this.state);
		this.record(command, autoMergeKey);
		this.notify(command.changes);
		return result;
	}

	/** 必要な外部情報を準備してから、一つの確定済み操作として実行する。 */
	public async execute<Name extends keyof Commands>(type: Name, input: CommandInput<Commands[Name]>, mergeKey: string | null = null): Promise<CommandResult<Commands[Name]>> {
		this.activeEdit?.finish();
		const { definition, input: savedInput, prepared } = this.prepareCommand(type, input);
		const resolved = prepared instanceof Promise ? await prepared : prepared;
		// 非同期の準備中にも連続編集は開始できる。適用前に確定し、状態の変更順と
		// 履歴順を揃えるとともに、古い編集セッションによる後からの巻き戻しを防ぐ。
		this.activeEdit?.finish();
		return this.applyPrepared(type, definition, savedInput, resolved, mergeKey);
	}

	/** 素材等の準備を必要としないUIの連続編集用。非同期Commandはexecuteを使う。 */
	public commit<Name extends keyof Commands>(type: Name, input: CommandInput<Commands[Name]>, mergeKey: string | null = null): CommandResult<Commands[Name]> {
		this.activeEdit?.finish();
		const { definition, input: savedInput, prepared } = this.prepareCommand(type, input);
		if (prepared instanceof Promise) {
			// prepareは状態を変更しない。誤った同期呼び出しの後に、未処理のrejectだけを残さない。
			void prepared.catch(() => {});
			throw new Error('Asynchronous commands must be executed with execute()');
		}
		return this.applyPrepared(type, definition, savedInput, prepared, mergeKey);
	}

	/**
	 * 連続編集の途中結果はすぐ通知するが、確定まで通常のUndo/Redo履歴を変更しない。
	 * 開始前の状態へ戻す操作と、最後の状態を復元する操作を別々に保持する。
	 */
	public beginEdit<Name extends keyof Commands>(type: Name) {
		this.activeEdit?.finish();
		this.autoMergeCandidate = null;
		let active = true;
		let pending: CommandLog<State, Change, keyof Commands> | null = null;
		const end = () => { active = false; this.activeEdit = null; };
		const session = {
			get active() { return active; },
			update: (input: CommandInput<Commands[Name]>): CommandResult<Commands[Name]> | null => {
				if (!active) return null;
				const { definition, prepared } = this.prepareCommand(type, input);
				if (prepared instanceof Promise) {
					void prepared.catch(() => {});
					throw new Error('Continuous editing requires synchronous preparation');
				}
				const result = cloneCommandData(prepared.result);
				if (prepared.change == null) return result;
				const command = this.createLog(type, definition, prepared.change, null);
				prepared.change.apply(this.state);
				if (pending == null) pending = command;
				else {
					pending.execute = command.execute;
					pending.changes = mergeCommandChanges(pending.changes, command.changes);
					pending.undoChanges = mergeCommandChanges(command.undoChanges, pending.undoChanges);
				}
				this.notify(command.changes);
				return result;
			},
			finish: () => {
				if (!active) return;
				end();
				if (pending == null) return;
				this.record(pending, null);
			},
			cancel: () => {
				if (!active) return;
				end();
				if (pending == null) return;
				pending.undo(this.state);
				this.notify(pending.undoChanges);
			},
		};
		this.activeEdit = session;
		return session;
	}

	public cancelEdit(): void { this.activeEdit?.cancel(); }

	/**
	 * グループは全体のロールバックを約束しない。途中の例外でも成功した操作を
	 * 一履歴へ確定し、呼び出し側が通常のUndoで戻せるようにする。
	 */
	public runGroup<Result>(label: string, run: () => Promise<Result>): Promise<Result>;
	public runGroup<Result>(label: string, run: () => Result): Result;
	public runGroup<Result>(label: string, run: () => Result | Promise<Result>): Result | Promise<Result> {
		this.activeEdit?.finish();
		this.autoMergeCandidate = null;
		const parent = this.activeGroup;
		const group = { label, commands: [] as CommandLog<State, Change, keyof Commands>[] };
		this.activeGroup = group;
		const finish = () => {
			this.activeEdit?.finish();
			this.activeGroup = parent;
			this.autoMergeCandidate = null;
			if (group.commands.length > 0) {
				const command: CommandLog<State, Change, keyof Commands> = {
					type: null,
					label,
					date: group.commands[0].date,
					execute: state => { for (const entry of group.commands) entry.execute(state); },
					undo: state => { for (const entry of group.commands.toReversed()) entry.undo(state); },
					changes: group.commands.flatMap(entry => entry.changes),
					undoChanges: group.commands.toReversed().flatMap(entry => entry.undoChanges),
					mergeKey: null,
				};
				if (parent != null) parent.commands.push(command);
				else { this.pushUndo(command); this.redoStack.value = []; }
			}
		};
		let result: Result | Promise<Result>;
		try {
			result = run();
		} catch (error) {
			finish();
			throw error;
		}
		if (result instanceof Promise) return result.finally(finish);
		finish();
		return result;
	}

	public undo(): void {
		this.autoMergeCandidate = null;
		if (this.activeEdit != null) { this.activeEdit.cancel(); return; }
		const command = this.undoStack.value.at(-1);
		if (command == null) return;
		command.undo(this.state);
		this.undoStack.value.pop();
		this.redoStack.value.push(command);
		triggerRef(this.undoStack);
		triggerRef(this.redoStack);
		this.notify(command.undoChanges);
	}

	public redo(): void {
		this.autoMergeCandidate = null;
		this.activeEdit?.cancel();
		const command = this.redoStack.value.at(-1);
		if (command == null) return;
		command.execute(this.state);
		this.redoStack.value.pop();
		this.pushUndo(command);
		triggerRef(this.redoStack);
		this.notify(command.changes);
	}
}
