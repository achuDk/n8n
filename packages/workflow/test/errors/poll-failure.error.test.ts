import {
	ConfigurationInvalidError,
	CredentialInvalidError,
	NodeApiError,
	NodeDefectError,
	NodeOperationError,
	pollFailureFromError,
	PollFailureError,
	QuotaExhaustedError,
	RateLimitedError,
	TemporarilyUnavailableError,
	type PollFailure,
} from '../../src/errors';
import type { INode } from '../../src/interfaces';

const node: INode = {
	id: '1',
	name: 'Test Node',
	typeVersion: 1,
	type: 'n8n-nodes-base.test',
	position: [0, 0],
	parameters: {},
};

describe('poll failure errors', () => {
	it.each<[new (n: INode, e: Error) => PollFailureError, PollFailure['failureClass']]>([
		[RateLimitedError, 'rate-limited'],
		[QuotaExhaustedError, 'quota-exhausted'],
		[TemporarilyUnavailableError, 'temporarily-unavailable'],
		[CredentialInvalidError, 'credential-invalid'],
		[ConfigurationInvalidError, 'configuration-invalid'],
		[NodeDefectError, 'node-defect'],
	])('%p declares its failure class', (errorClass, failureClass) => {
		const error = new errorClass(node, new Error('upstream failure'));

		expect(error).toBeInstanceOf(PollFailureError);
		expect(error).toBeInstanceOf(NodeOperationError);
		expect(error.pollFailure).toEqual({ failureClass });
	});

	it('carries the declared retry delay', () => {
		const error = new RateLimitedError(node, new Error('429'), { retryAfterMs: 30_000 });

		expect(error.pollFailure).toEqual({ failureClass: 'rate-limited', retryAfterMs: 30_000 });
	});

	it('carries the declared quota reset time', () => {
		const resetsAt = new Date('2026-08-19T00:00:00.000Z');
		const error = new QuotaExhaustedError(node, new Error('quota'), { resetsAt });

		expect(error.pollFailure).toEqual({ failureClass: 'quota-exhausted', resetsAt });
	});

	it('replaces a wrapped error message with the class default', () => {
		const error = new CredentialInvalidError(node, new Error('invalid_grant'));

		expect(error.message).toBe(
			'The credential connected to this node is no longer valid. Please reconnect it.',
		);
	});

	it('keeps an explicit message over the class default', () => {
		const error = new ConfigurationInvalidError(node, new Error('404'), {
			message: 'The watched folder no longer exists.',
		});

		expect(error.message).toBe('The watched folder no longer exists.');
	});

	it('uses a string error as the message', () => {
		const error = new CredentialInvalidError(node, 'Please reconnect the credential.');

		expect(error.message).toBe('Please reconnect the credential.');
	});

	it('stamps the original error when wrapping an existing NodeOperationError', () => {
		const original = new NodeOperationError(node, new Error('boom'));

		const wrapped = new CredentialInvalidError(node, original);

		expect(wrapped).toBe(original);
		expect(pollFailureFromError(wrapped)).toEqual({ failureClass: 'credential-invalid' });
	});
});

describe('pollFailureFromError', () => {
	it('reads the declaration off the thrown error itself', () => {
		const error = new RateLimitedError(node, new Error('429'), { retryAfterMs: 1000 });

		expect(pollFailureFromError(error)).toEqual({
			failureClass: 'rate-limited',
			retryAfterMs: 1000,
		});
	});

	it('reads the declaration through wrapping errors', () => {
		const declared = new QuotaExhaustedError(node, new Error('quota'));
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
		const inner = new TemporarilyUnavailableError(node, new Error('503'));
		const outer = Object.assign(new Error('outer'), {
			pollFailure: { failureClass: 'credential-invalid' },
			cause: inner,
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
