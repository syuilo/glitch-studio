// 汎用的なUndo/Redo実装。Glitch Studioのドメイン知識を持っていてはならない

import { computed, shallowRef, triggerRef } from 'vue';
import { deepClone } from '@gs/shared/utility/deep-clone.js';

export type CommandDef<S, Payload, Change> = {
	label: string;
	// 最後のexecuteだけで連続編集の最終状態を再現できる操作に限り許可する。
	// 同じ種類でも対象や編集項目が異なる場合は、別のキーを返すこと。
	getAutoMergeKey?: (payload: Payload) => string | null;
	// 確定した状態の変更対象・内容を宣言する。どの通知を同期するか、キャッシュや
	// 実行インスタンスを保持するかは購読側の責務とし、履歴操作でも同じ通知を使う。
	changes: (state: S, payload: Payload) => Change[];
	create: (payload: Payload) => {
		execute(state: S): void;
		undo(state: S): void;
	};
};

type CommandLog<S, Change, T extends Record<string, CommandDef<S, any, Change>>> = {
	type: keyof T;
	date: number;
	execute: (state: S) => void;
	undo: (state: S) => void;
	mergeKey?: string | null;
};

export class UndoRedo<S, Change, Commands extends Record<string, CommandDef<S, any, Change>>> {
	public state: S;
	public undoStack = shallowRef([] as CommandLog<S, Change, Commands>[]);
	public redoStack = shallowRef([] as CommandLog<S, Change, Commands>[]);
	public canUndo = computed(() => this.undoStack.value.length > 0);
	public canRedo = computed(() => this.redoStack.value.length > 0);
	private maxUndoStackSize = 100;
	private changeListeners = new Set<(changes: Change[]) => void>();
	private commandDefs: Commands;
	private activeEdit: { finish(): void; cancel(): void } | null = null;
	private autoMergeCandidate: { command: CommandLog<S, Change, Commands>; key: string; lastUpdatedAt: number } | null = null;

	public onChange(listener: (changes: Change[]) => void): () => void {
		this.changeListeners.add(listener);
		return () => { this.changeListeners.delete(listener); };
	}

	constructor(state: S, commandDefs: Commands) {
		this.state = state;
		this.commandDefs = commandDefs;
	}

	private createCommand<T extends keyof Commands>(type: T, payload: Parameters<Commands[T]['create']>[0]) {
		const commandDef = this.commandDefs[type] as CommandDef<S, Parameters<Commands[T]['create']>[0], Change>;
		const savedPayload = deepClone(payload);
		const actions = commandDef.create(savedPayload);
		const notify = (state: S) => {
			const changes = commandDef.changes(state, savedPayload);
			for (const listener of this.changeListeners) listener(changes);
		};
		// 履歴へ通知込みの操作を保存する。マージされたRedoも最終payloadを通知し、
		// Undoは最初のpayloadを使うので、ドラッグ中も確定後も同じ同期経路を通る。
		return {
			execute: (state: S) => { actions.execute(state); notify(state); },
			undo: (state: S) => { actions.undo(state); notify(state); },
		};
	}

	/**
	 * 連続操作は通常と同じ変更通知を出すが、確定まで履歴を追加・破棄しない。
	 * キャンセルで既存のRedoまで失うことを防ぎ、複数値の更新も一操作として戻す。
	 * 別コマンドの実行は先に確定し、後から古いドラッグで新しい編集を巻き戻さない。
	 */
	public beginEdit<T extends keyof Commands>(type: T) {
		this.activeEdit?.finish();
		// 確定も取消しも独立した操作の境界とし、前後の通常入力をつなげない。
		this.autoMergeCandidate = null;
		let active = true;
		let pending: CommandLog<S, Change, Commands> | null = null;
		const end = () => { active = false; this.activeEdit = null; };
		const session = {
			get active() { return active; },
			update: (payload: Parameters<Commands[T]['create']>[0]) => {
				if (!active) return;
				const command = this.createCommand(type, payload);
				command.execute(this.state);
				if (pending == null) pending = { type, date: Date.now(), ...command };
				else pending.execute = command.execute;
			},
			finish: () => {
				if (!active) return;
				end();
				if (pending == null) return;
				this.undoStack.value.push(pending);
				if (this.undoStack.value.length > this.maxUndoStackSize) this.undoStack.value.shift();
				triggerRef(this.undoStack);
				this.redoStack.value = [];
			},
			cancel: () => {
				if (!active) return;
				end();
				pending?.undo(this.state);
			},
		};
		this.activeEdit = session;
		return session;
	}

	public cancelEdit() { this.activeEdit?.cancel(); }

	public commit<T extends keyof Commands>(type: T, payload: Parameters<Commands[T]['create']>[0], mergeKey?: string | null) {
		this.activeEdit?.finish();
		const commandDef = this.commandDefs[type] as CommandDef<S, Parameters<Commands[T]['create']>[0], Change>;
		// 明示キーのある操作と自動マージは互いに独立させ、別ドラッグまで吸収しない。
		const autoMergeKey = mergeKey == null ? commandDef.getAutoMergeKey?.(payload) ?? null : null;
		const now = performance.now();
		const command = this.createCommand(type, payload);
		command.execute(this.state);

		const latest = this.undoStack.value.at(-1);
		const candidate = this.autoMergeCandidate;
		const canAutoMerge = candidate != null && candidate.command === latest && candidate.key === autoMergeKey
			&& now - candidate.lastUpdatedAt <= 2000;
		const canMerge = latest != null && latest.type === type
			&& (mergeKey != null ? latest.mergeKey === mergeKey : canAutoMerge);
		const commandLog: CommandLog<S, Change, Commands> = canMerge ? latest : { type, date: Date.now(), ...command, mergeKey };
		if (canMerge) {
			commandLog.execute = command.execute;
		} else {
			this.undoStack.value.push(commandLog);
			if (this.undoStack.value.length > this.maxUndoStackSize) {
				this.undoStack.value.shift();
			}
			triggerRef(this.undoStack);
			console.log('Committed command:', type, deepClone(payload));
		}
		// 作成時刻ではなく直前の更新から測るため、マージできた場合も時刻を進める。
		this.autoMergeCandidate = autoMergeKey == null ? null : { command: commandLog, key: autoMergeKey, lastUpdatedAt: now };

		this.redoStack.value = [];
		triggerRef(this.redoStack);
	}

	public undo() {
		this.autoMergeCandidate = null;
		if (this.activeEdit != null) { this.activeEdit.cancel(); return; }
		const command = this.undoStack.value.pop();
		triggerRef(this.undoStack);
		if (command == null) return;
		command.undo(this.state);
		this.redoStack.value.push(command);
		triggerRef(this.redoStack);
	}

	public redo() {
		this.autoMergeCandidate = null;
		if (this.activeEdit != null) this.activeEdit.cancel();
		const command = this.redoStack.value.pop();
		triggerRef(this.redoStack);
		if (command == null) return;
		command.execute(this.state);
		this.undoStack.value.push(command);
		triggerRef(this.undoStack);
	}
}
