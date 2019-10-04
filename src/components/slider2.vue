<template>
<div class="slider-component">
	<div class="track" ref="track"></div>
	<div class="indicator" ref="indicator"></div>
	<div class="thumb" ref="a" @mousedown="onMousedown('a')"></div>
	<div class="thumb" ref="b" @mousedown="onMousedown('b')"></div>
</div>
</template>

<script lang="ts">
import Vue, { PropType } from 'vue';

export default Vue.extend({
	props: {
		value: {
			type: Array as PropType<number[]>,
			required: true
		},

		step: {
			type: Number,
			required: false
		},

		min: {
			type: Number,
			required: true
		},

		max: {
			type: Number,
			required: true
		}
	},

	data() {
		return {
			aDragging: false,
			bDragging: false,
			a: 0,
			b: 0,
		};
	},

	computed: {
		v(): number[] {
			const min = Math.min(this.a, this.b);
			const max = Math.max(this.a, this.b);
			const range = this.max - this.min;
			return [(min * range) + min, (max * range) + min];
		},
	},

	created() {
		const range = this.max - this.min;
		this.a = (this.value[0] - this.min) / range;
		this.b = (this.value[1] - this.min) / range;
	},

	mounted() {
		this.render();

		const resizeObserver = new (window as any).ResizeObserver(this.render);
		resizeObserver.observe(this.$el);

		document.addEventListener('mousemove', this.onMousemove);
		document.addEventListener('mouseup', this.onMouseup);
	},

	beforeDestroy() {
		document.removeEventListener('mousemove', this.onMousemove);
		document.removeEventListener('mouseup', this.onMouseup);
	},

	methods: {
		render() {
			const track = (this.$refs.track as HTMLElement).getBoundingClientRect();
			(this.$refs.indicator as HTMLElement).style.left = (Math.min(this.a, this.b) * track.width) + 'px';
			(this.$refs.indicator as HTMLElement).style.width = ((Math.max(this.a, this.b) - Math.min(this.a, this.b)) * 100) + '%';

			const thumbSize = 20;
			const ax = Math.min(this.a, this.b) * (track.width - thumbSize);
			const bx = Math.max(this.a, this.b) * (track.width - thumbSize);
			(this.$refs.a as HTMLElement).style.left = ax + 'px';
			(this.$refs.b as HTMLElement).style.left = bx + 'px';
		},

		onMousedown(ab: string) {
			if (ab === 'a') this.aDragging = true;
			if (ab === 'b') this.bDragging = true;
		},

		onMousemove(e: MouseEvent) {
			if (!this.aDragging && !this.bDragging) return;
			const track = (this.$refs.track as HTMLElement).getBoundingClientRect();
			const thumbSize = 20;
			const x = Math.max(0, Math.min(track.width - thumbSize, (e.pageX - (thumbSize / 2)) - track.left));
			const v = (x / (track.width - thumbSize));

			if (this.aDragging) {
				this.a = v;
			} else {
				this.b = v;
			}

			this.render();
			this.$emit('input', this.v);
		},

		onMouseup() {
			this.aDragging = false;
			this.bDragging = false;
			this.$emit('change', this.v);
		}
	}
});
</script>

<style scoped lang="scss">
.slider-component {
	position: relative;

	.track {
		height: 4px;
		width: 100%;
		background: #111;
		border-bottom: solid 1px rgba(255, 255, 255, 0.12);
		border-radius: 4px;
		margin: 10px 0 10px 0;
	}

	.thumb {
		position: absolute;
		top: -8px;
		z-index: 1;
		border: solid 1px rgba(0, 0, 0, 0.7);
		background: linear-gradient(0deg, #1b1b1b, #2a2a2a);
		box-shadow: 0 1px 1px rgba(0, 0, 0, 0.1), 0 1px 0 rgba(255, 255, 255, 0.1) inset;
		height: 20px;
		width: 20px;
		border-radius: 20px;
		cursor: ew-resize;
		margin-top: 0px;

		&:hover {
			background: linear-gradient(0deg, #252525, #303030);
		}
	}

	.indicator {
		position: absolute;
		top: 1px;
		left: 0;
		height: 2px;
		background: #bb6100;
		border-radius: 2px;
		pointer-events: none;
	}
}
</style>
