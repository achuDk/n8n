import { NodeApiError, declarePollFailure, pollFailureFromError } from '../../src/errors';
import type { INode } from '../../src/interfaces';

const node: INode = {
	id: '1',
	name: 'Test Node',
	typeVersion: 1,
	type: 'n8n-nodes-base.test',
	position: [0, 0],
	parameters: {},
};

describe('declarePollFailure', () => {
	it('stamps the failure onto the same error instance', () => {
		const error = new NodeApiError(node, { message: 'api failure', httpCode: '401' });

		const declared = declarePollFailure(error, { failureClass: 'credential-invalid' });

		expect(declared).toBe(error);
		expect(declared.name).toBe('NodeApiError');
		expect(declared.httpCode).toBe('401');
		expect(declared.pollFailure).toEqual({ failureClass: 'credential-invalid' });
	});

	it('carries the declared retry delay', () => {
		const error = declarePollFailure(new Error('429'), {
			failureClass: 'rate-limited',
			retryAfterMs: 30_000,
		});

		expect(pollFailureFromError(error)).toEqual({
			failureClass: 'rate-limited',
			retryAfterMs: 30_000,
		});
	});

	it('carries the declared quota reset time', () => {
		const resetsAt = new Date('2026-08-19T00:00:00.000Z');
		const error = declarePollFailure(new Error('quota'), {
			failureClass: 'quota-exhausted',
			resetsAt,
		});

		expect(pollFailureFromError(error)).toEqual({ failureClass: 'quota-exhausted', resetsAt });
	});
});

describe('pollFailureFromError', () => {
	it('reads the declaration off the thrown error itself', () => {
		const error = declarePollFailure(new Error('429'), {
			failureClass: 'rate-limited',
			retryAfterMs: 1000,
		});

		expect(pollFailureFromError(error)).toEqual({
			failureClass: 'rate-limited',
			retryAfterMs: 1000,
		});
	});

	it('reads the declaration through wrapping errors', () => {
		const declared = declarePollFailure(new Error('quota'), { failureClass: 'quota-exhausted' });
		const wrapped = new NodeApiError(node, declared as never);
		const doubleWrapped = new Error('outer', { cause: wrapped });

		expect(pollFailureFromError(doubleWrapped)).toEqual({ failureClass: 'quota-exhausted' });
	});

	it('reads a declaration from a duplicated package copy, without instanceof', () => {
		const foreign = Object.assign(new Error('throttled'), {
			pollFailure: { failureClass: 'rate-limited', retryAfterMs: 500 },
		});

		expect(pollFailureFromError(foreign)).toEqual({
			failureClass: 'rate-limited',
			retryAfterMs: 500,
		});
	});

	it('prefers the shallowest declaration', () => {
		const inner = declarePollFailure(new Error('503'), {
			failureClass: 'temporarily-unavailable',
		});
		const outer = declarePollFailure(new Error('outer', { cause: inner }), {
			failureClass: 'credential-invalid',
		});

		expect(pollFailureFromError(outer)).toEqual({ failureClass: 'credential-invalid' });
	});

	it('returns null for an unannotated error', () => {
		expect(pollFailureFromError(new Error('plain failure'))).toBeNull();
		expect(pollFailureFromError(new NodeApiError(node, { message: 'api failure' }))).toBeNull();
		expect(pollFailureFromError('not an object')).toBeNull();
		expect(pollFailureFromError(null)).toBeNull();
	});

	it('rejects an unknown failure class', () => {
		const error = Object.assign(new Error('boom'), {
			pollFailure: { failureClass: 'made-up' },
		});

		expect(pollFailureFromError(error)).toBeNull();
	});

	it('keeps a zero retry delay', () => {
		const error = Object.assign(new Error('429'), {
			pollFailure: { failureClass: 'rate-limited', retryAfterMs: 0 },
		});

		expect(pollFailureFromError(error)).toEqual({
			failureClass: 'rate-limited',
			retryAfterMs: 0,
		});
	});

	it('drops malformed declaration data but keeps the class', () => {
		const badDelay = Object.assign(new Error('429'), {
			pollFailure: { failureClass: 'rate-limited', retryAfterMs: -5 },
		});
		const badReset = Object.assign(new Error('quota'), {
			pollFailure: { failureClass: 'quota-exhausted', resetsAt: 'tomorrow' },
		});

		expect(pollFailureFromError(badDelay)).toEqual({ failureClass: 'rate-limited' });
		expect(pollFailureFromError(badReset)).toEqual({ failureClass: 'quota-exhausted' });
	});

	it('survives a self-referential cause chain', () => {
		const error = new Error('loop') as Error & { cause: unknown };
		error.cause = error;

		expect(pollFailureFromError(error)).toBeNull();
	});
});
