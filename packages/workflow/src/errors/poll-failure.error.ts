/**
 * Why a poll failed, declared by the node that polled. Plain data stamped on a
 * thrown error, so it survives wrapping and duplicated copies of this package.
 */
export type PollFailure =
	/** The source is throttling requests. Retryable and must not count as a failing source. */
	| { failureClass: 'rate-limited'; retryAfterMs?: number }
	/** A usage quota is used up until it resets. Retryable and must not count as a failing source. */
	| { failureClass: 'quota-exhausted'; resetsAt?: Date }
	/** The source is down or degraded right now. Retryable on the usual backoff curve. */
	| { failureClass: 'temporarily-unavailable' }
	/** The credential is proven dead. Not retryable, the user must reconnect it. */
	| { failureClass: 'credential-invalid' }
	/** The node points at something that no longer exists or is no longer allowed. Not retryable, the user must edit the workflow. */
	| { failureClass: 'configuration-invalid' }
	/** A bug in the node itself. Not retryable, and neither the credential nor the configuration is to blame. */
	| { failureClass: 'node-defect' };

export type PollFailureClass = PollFailure['failureClass'];

/**
 * Stamps the declared failure onto `error` and returns the same instance, so
 * the error keeps its class, name, message and every other property. A poll
 * trigger node throws the stamped error to say why its poll failed instead of
 * leaving the platform to guess from the HTTP status.
 * {@link pollFailureFromError} reads the declaration back. Outside a poll the
 * declaration is inert metadata.
 */
export function declarePollFailure<T extends object>(
	error: T,
	failure: PollFailure,
): T & { pollFailure: PollFailure } {
	return Object.assign(error, { pollFailure: failure });
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
