import type { NodeOperationErrorOptions } from './node-api.error';
import { NodeOperationError } from './node-operation.error';
import type { INode, JsonObject } from '../interfaces';

/**
 * Why a poll failed, declared by the node that polled. Plain data read off a
 * thrown error, so it survives wrapping and duplicated copies of this package.
 */
export type PollFailure =
	| { failureClass: 'rate-limited'; retryAfterMs?: number }
	| { failureClass: 'quota-exhausted'; resetsAt?: Date }
	| { failureClass: 'temporarily-unavailable' }
	| { failureClass: 'credential-invalid' }
	| { failureClass: 'configuration-invalid' }
	| { failureClass: 'node-defect' };

export type PollFailureClass = PollFailure['failureClass'];

/**
 * Base of the declared poll failure errors. A poll trigger node throws one to
 * say why its poll failed instead of leaving the platform to guess from the
 * HTTP status. The declaration is stamped as the plain `pollFailure` property,
 * which {@link pollFailureFromError} reads back.
 *
 * Wrapping an existing `NodeOperationError` keeps that instance and only adds
 * the declaration to it. Outside a poll the declaration is inert metadata.
 */
export abstract class PollFailureError extends NodeOperationError {
	readonly pollFailure: PollFailure;

	constructor(
		node: INode,
		error: Error | string | JsonObject,
		failure: PollFailure,
		defaultMessage: string,
		options: NodeOperationErrorOptions = {},
	) {
		super(node, error, {
			...options,
			message: options.message ?? (typeof error === 'string' ? undefined : defaultMessage),
		});
		// Assigned after super so the stamp also lands when the parent constructor
		// returns the already-wrapped error instead of this instance.
		this.pollFailure = failure;
	}
}

/** The source is throttling requests. Retryable and must not count as a failing source. */
export class RateLimitedError extends PollFailureError {
	constructor(
		node: INode,
		error: Error | string | JsonObject,
		options: NodeOperationErrorOptions & { retryAfterMs?: number } = {},
	) {
		const { retryAfterMs, ...rest } = options;
		super(
			node,
			error,
			{ failureClass: 'rate-limited', ...(retryAfterMs === undefined ? {} : { retryAfterMs }) },
			'The service is rate limiting requests. Polling continues once the limit lifts.',
			rest,
		);
	}
}

/** A usage quota is used up until it resets. Retryable and must not count as a failing source. */
export class QuotaExhaustedError extends PollFailureError {
	constructor(
		node: INode,
		error: Error | string | JsonObject,
		options: NodeOperationErrorOptions & { resetsAt?: Date } = {},
	) {
		const { resetsAt, ...rest } = options;
		super(
			node,
			error,
			{ failureClass: 'quota-exhausted', ...(resetsAt === undefined ? {} : { resetsAt }) },
			'The service quota is used up. Polling continues once it resets.',
			rest,
		);
	}
}

/** The source is down or degraded right now. Retryable on the usual backoff curve. */
export class TemporarilyUnavailableError extends PollFailureError {
	constructor(
		node: INode,
		error: Error | string | JsonObject,
		options: NodeOperationErrorOptions = {},
	) {
		super(
			node,
			error,
			{ failureClass: 'temporarily-unavailable' },
			'The service is temporarily unavailable.',
			options,
		);
	}
}

/** The credential is proven dead. Not retryable, the user must reconnect it. */
export class CredentialInvalidError extends PollFailureError {
	constructor(
		node: INode,
		error: Error | string | JsonObject,
		options: NodeOperationErrorOptions = {},
	) {
		super(
			node,
			error,
			{ failureClass: 'credential-invalid' },
			'The credential connected to this node is no longer valid. Please reconnect it.',
			options,
		);
	}
}

/** The node points at something that no longer exists or is no longer allowed. Not retryable, the user must edit the workflow. */
export class ConfigurationInvalidError extends PollFailureError {
	constructor(
		node: INode,
		error: Error | string | JsonObject,
		options: NodeOperationErrorOptions = {},
	) {
		super(
			node,
			error,
			{ failureClass: 'configuration-invalid' },
			'The node configuration is no longer valid. Please update it in the workflow.',
			options,
		);
	}
}

/** A bug in the node itself. Not retryable, and neither the credential nor the configuration is to blame. */
export class NodeDefectError extends PollFailureError {
	constructor(
		node: INode,
		error: Error | string | JsonObject,
		options: NodeOperationErrorOptions = {},
	) {
		super(
			node,
			error,
			{ failureClass: 'node-defect' },
			'The node hit a problem in its own code and cannot recover on its own.',
			options,
		);
	}
}

const MAX_CHAIN_DEPTH = 5;

/** The keys errors wrap each other under. */
const WRAPPING_KEYS = ['cause', 'errorResponse', 'reason'] as const;

type UnknownRecord = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is UnknownRecord =>
	typeof value === 'object' && value !== null;

function toPollFailure(value: unknown): PollFailure | null {
	if (!isRecord(value)) return null;

	switch (value.failureClass) {
		case 'rate-limited': {
			const { retryAfterMs } = value;
			const isValidDelay =
				typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs >= 0;
			return isValidDelay
				? { failureClass: 'rate-limited', retryAfterMs }
				: { failureClass: 'rate-limited' };
		}
		case 'quota-exhausted': {
			const { resetsAt } = value;
			const isValidReset = resetsAt instanceof Date && Number.isFinite(resetsAt.getTime());
			return isValidReset
				? { failureClass: 'quota-exhausted', resetsAt }
				: { failureClass: 'quota-exhausted' };
		}
		case 'temporarily-unavailable':
		case 'credential-invalid':
		case 'configuration-invalid':
		case 'node-defect':
			return { failureClass: value.failureClass };
		default:
			return null;
	}
}

/**
 * The poll failure declared on `error` or on any error it wraps, or `null`
 * when the failure is unannotated. The shallowest declaration wins. Malformed
 * declaration data is dropped rather than trusted. Never throws.
 */
export function pollFailureFromError(error: unknown): PollFailure | null {
	if (!isRecord(error)) {
		return null;
	}

	const seen = new Set<UnknownRecord>([error]);
	let generation: UnknownRecord[] = [error];

	for (let depth = 0; depth <= MAX_CHAIN_DEPTH && generation.length > 0; depth++) {
		const next: UnknownRecord[] = [];

		for (const candidate of generation) {
			const failure = toPollFailure(candidate.pollFailure);
			if (failure !== null) {
				return failure;
			}

			for (const key of WRAPPING_KEYS) {
				const wrapped = candidate[key];
				if (isRecord(wrapped) && !seen.has(wrapped)) {
					seen.add(wrapped);
					next.push(wrapped);
				}
			}
		}

		generation = next;
	}

	return null;
}
