<script setup lang="ts">
import { computed, ref } from 'vue';
import type { NodeHint } from 'n8n-workflow';
import { N8nCallout, N8nIcon, N8nText } from '@n8n/design-system';
import type { CalloutTheme } from '@n8n/design-system';

type HintEntry = {
	key: string;
	theme: CalloutTheme;
	hints: NodeHint[];
	/** Only set for grouped hints; `{count}` is interpolated on render */
	summary?: string;
};

const props = defineProps<{
	hints: NodeHint[];
}>();

const expandedKeys = ref(new Set<string>());

/**
 * Hints carrying the same `group.key` collapse into one entry — a node that
 * reports the same problem for 20 fields would otherwise push the data out of
 * the pane. Ungrouped hints stay one entry each, in their original order.
 */
const entries = computed<HintEntry[]>(() => {
	const groups = new Map<string, HintEntry>();

	return props.hints.reduce<HintEntry[]>((acc, hint) => {
		const theme = hint.type ?? 'info';

		if (!hint.group) {
			acc.push({ key: `hint:${hint.message}`, theme, hints: [hint] });
			return acc;
		}

		const existing = groups.get(hint.group.key);

		if (existing) {
			existing.hints.push(hint);
			return acc;
		}

		const entry: HintEntry = {
			key: `group:${hint.group.key}`,
			theme,
			hints: [hint],
			summary: hint.group.summary,
		};

		groups.set(hint.group.key, entry);
		acc.push(entry);

		return acc;
	}, []);
});

function isCollapsible(entry: HintEntry) {
	return entry.hints.length > 1 && !!entry.summary;
}

function summaryText(entry: HintEntry) {
	return entry.summary?.replace('{count}', entry.hints.length.toString()) ?? '';
}

/**
 * With a short label per hint (a field name, say) the expanded list reads as an
 * inline enumeration; without one it has to fall back to stacked full messages.
 */
function hasLabels(entry: HintEntry) {
	return entry.hints.every((hint) => !!hint.group?.label);
}

function isExpanded(entry: HintEntry) {
	return expandedKeys.value.has(entry.key);
}

function toggle(entry: HintEntry) {
	const next = new Set(expandedKeys.value);

	if (next.has(entry.key)) {
		next.delete(entry.key);
	} else {
		next.add(entry.key);
	}

	expandedKeys.value = next;
}
</script>

<template>
	<div :class="$style.hints">
		<N8nCallout
			v-for="entry in entries"
			:key="entry.key"
			:theme="entry.theme"
			:align-top="isCollapsible(entry) && isExpanded(entry)"
			:class="isCollapsible(entry) ? $style.clickable : undefined"
			data-test-id="node-hint"
			@click="isCollapsible(entry) && toggle(entry)"
		>
			<template v-if="isCollapsible(entry)">
				<N8nText size="small" data-test-id="node-hint-summary">{{ summaryText(entry) }}</N8nText>
				<ul
					v-if="isExpanded(entry)"
					:class="hasLabels(entry) ? $style.labels : $style.messages"
					data-test-id="node-hint-details"
				>
					<li v-for="hint in entry.hints" :key="hint.message" data-test-id="node-hint-message">
						<N8nText v-if="hint.group?.label" size="small">{{ hint.group.label }}</N8nText>
						<N8nText v-else v-n8n-html="hint.message" size="small" />
					</li>
				</ul>
			</template>
			<N8nText v-else v-n8n-html="entry.hints[0].message" size="small" />

			<!-- Sibling of the message section so the callout's space-between pins it right -->
			<template v-if="isCollapsible(entry)" #trailingContent>
				<button
					type="button"
					:class="$style.toggle"
					:aria-expanded="isExpanded(entry)"
					:aria-label="summaryText(entry)"
					data-test-id="node-hint-toggle"
					@click.stop="toggle(entry)"
				>
					<N8nIcon :icon="isExpanded(entry) ? 'chevron-up' : 'chevron-down'" size="small" />
				</button>
			</template>
		</N8nCallout>
	</div>
</template>

<style lang="scss" module>
.hints {
	display: flex;
	flex-direction: column;
	gap: var(--spacing--xs);
}

.clickable {
	cursor: pointer;
}

.toggle {
	display: flex;
	align-items: center;
	margin-left: var(--spacing--2xs);
	padding: 0;
	border: none;
	background: none;
	color: inherit;
	cursor: pointer;
}

.messages {
	margin: var(--spacing--2xs) 0 0;
	padding-left: var(--spacing--sm);
	list-style: disc;

	> li:not(:last-child) {
		margin-bottom: var(--spacing--3xs);
	}
}

.labels {
	display: flex;
	flex-wrap: wrap;
	column-gap: var(--spacing--3xs);
	margin: var(--spacing--2xs) 0 0;
	padding: 0;
	list-style: none;

	> li:not(:last-child)::after {
		content: ',';
	}
}
</style>
