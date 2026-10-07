// 汎用的なUndo/Redo実装。Glitch Studioのドメイン知識を持っていてはならない

import { computed, shallowRef, triggerRef } from 'vue';
import { deepClone } from '@gs/shared/utility/deep-clone.js';

export type CommandDef<S, Payload, Change> = {
	label: string;
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
		const command = this.createCommand(type, payload);
		command.execute(this.state);

		const latest = this.undoStack.value.at(-1);
		if (latest != null && mergeKey != null && latest.mergeKey === mergeKey) {
			latest.execute = command.execute;
		} else {
			this.undoStack.value.push({
				type,
				date: Date.now(),
				execute: command.execute,
				undo: command.undo,
				mergeKey,
			});
			if (this.undoStack.value.length > this.maxUndoStackSize) {
				this.undoStack.value.shift();
			}
			triggerRef(this.undoStack);
			console.log('Committed command:', type, deepClone(payload));
		}

		this.redoStack.value = [];
		triggerRef(this.redoStack);
	}

	public undo() {
		if (this.activeEdit != null) { this.activeEdit.cancel(); return; }
		const command = this.undoStack.value.pop();
		triggerRef(this.undoStack);
		if (command == null) return;
		command.undo(this.state);
		this.redoStack.value.push(command);
		triggerRef(this.redoStack);
	}

	public redo() {
		if (this.activeEdit != null) this.activeEdit.cancel();
		const command = this.redoStack.value.pop();
		triggerRef(this.redoStack);
		if (command == null) return;
		command.execute(this.state);
		this.undoStack.value.push(command);
		triggerRef(this.undoStack);
	}
}
