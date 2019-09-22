<template>
<XDialog>
	<div class="input-dialog-componet">
		<div>
			<input type="text" v-model="value" ref="input"/>
		</div>
		<footer>
			<button @click="cancel()">Cancel</button>
			<button class="primary" @click="ok()">OK</button>
		</footer>
	</div>
</XDialog>
</template>

<script lang="ts">
import Vue from 'vue';
import XDialog from './dialog.vue';

export default Vue.extend({
	components: { XDialog },

	data() {
		return {
			value: ''
		};
	},

	mounted() {
		this.$nextTick(() => {
			(this.$refs.input as HTMLInputElement).focus();
		});
	},

	methods: {
		ok() {
			this.$emit('ok', this.value);
		},

		cancel() {
			this.$emit('cancel');
		}
	}
});
</script>

<style scoped lang="scss">
.input-dialog-componet {
	> div {
		margin: 0 0 16px 0;
	}

	> footer {
		display: flex;
		margin-top: 24px;

		> button:first-child {
			margin-right: 16px;
		}
	}
}
</style>
