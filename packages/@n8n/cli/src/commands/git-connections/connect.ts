import { Args, Flags } from '@oclif/core';

import { BaseCommand } from '../../base-command';

export default class GitConnectionsConnect extends BaseCommand {
	static override description = 'Connect a Git connection';
	static override args = { id: Args.string({ description: 'Git connection ID', required: true }) };
	static override flags = {
		...BaseCommand.baseFlags,
		branchName: Flags.string({ description: 'Remote branch to connect', aliases: ['branch-name'] }),
	};

	async run() {
		const { args, flags } = await this.parse(GitConnectionsConnect);
		await this.execute(async () => {
			this.output(
				await this.getClient(flags).connectGitConnection(args.id, flags.branchName),
				flags,
			);
		});
	}
}
