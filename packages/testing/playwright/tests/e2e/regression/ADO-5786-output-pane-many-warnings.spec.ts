import { test, expect } from '../../../fixtures/base';

// The fixture's Split Out node is asked for 20 fields that no input item has, so the
// node reports 20 warnings above a 20 row table. No credentials, no network, no code
// sandbox: the warning count is deterministic.
const EXPECTED_WARNINGS = 20;

// Warnings are secondary to the data: whatever their number, the table keeps the
// larger share of the pane and the warnings stay within their capped area.
// Pre-fix the warnings ate the whole column and the data container was 0px high.
const MIN_DATA_SHARE_OF_PANE = 0.4;
const MAX_WARNINGS_SHARE_OF_PANE = 0.5;

// Layout settles a frame or two after the table renders, so retry the measurement
// rather than sampling it once.
const LAYOUT_TIMEOUT = 5000;

test.describe(
	'ADO-5786 NDV output pane stays usable with many warnings',
	{
		annotation: [{ type: 'owner', description: 'Adore' }],
	},
	() => {
		test('keeps the output table readable when the node reports many warnings', async ({ n8n }) => {
			await n8n.start.fromImportedWorkflow('Test_workflow_ndv_many_output_warnings.json');

			// Executed from the NDV rather than the canvas: no toast to wait on, the hint
			// summary below is the signal that the run landed
			await n8n.canvas.openNode('Split Out');
			await n8n.ndv.execute();
			await n8n.notifications.quickCloseAll();

			// Warnings of the same kind collapse into one callout carrying the count
			await expect(n8n.ndv.outputPanel.getNodeHints()).toHaveCount(1);
			await expect(n8n.ndv.outputPanel.getNodeHintSummary()).toHaveText(
				`${EXPECTED_WARNINGS} fields weren't found in your input items`,
			);
			await expect(n8n.ndv.outputPanel.getTable()).toBeVisible();

			const expectDataKeepsThePane = async () => {
				await expect(async () => {
					const paneHeight = (await n8n.ndv.outputPanel.get().boundingBox())?.height ?? 0;
					const dataHeight =
						(await n8n.ndv.outputPanel.getDataContainer().boundingBox())?.height ?? 0;
					const warningsHeight =
						(await n8n.ndv.outputPanel.getHintsContainer().boundingBox())?.height ?? 0;

					expect(paneHeight).toBeGreaterThan(0);
					expect(dataHeight).toBeGreaterThan(paneHeight * MIN_DATA_SHARE_OF_PANE);
					expect(warningsHeight).toBeLessThan(paneHeight * MAX_WARNINGS_SHARE_OF_PANE);
				}).toPass({ timeout: LAYOUT_TIMEOUT });
			};

			await expectDataKeepsThePane();

			await n8n.page.screenshot({ path: '/tmp/hints-collapsed.png' });

			// Every message stays reachable by expanding the group...
			await n8n.ndv.outputPanel.getNodeHintToggle().click();
			await n8n.page.screenshot({ path: '/tmp/hints-expanded.png' });
			await expect(n8n.ndv.outputPanel.getNodeHintMessages()).toHaveCount(EXPECTED_WARNINGS);

			// ...and the expanded list scrolls within its own area instead of starving the table
			await expectDataKeepsThePane();

			// Readable, not just present: the table isn't clipped out of view
			await expect(n8n.ndv.outputPanel.getTableHeader(0)).toBeInViewport();
			await expect(n8n.ndv.outputPanel.getTableRow(1)).toBeInViewport();
		});
	},
);
