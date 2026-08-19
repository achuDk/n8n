import type {
	ContentImportContext,
	CredentialDecryptContext,
	EnforcementPoint,
	PolicyDecision,
	WorkflowPublishContext,
	WorkflowSaveContext,
	WorkflowStartContext,
	WorkflowTransferContext,
} from '@n8n/decorators';

/**
 * Which context each point is called with, mirroring `RegisteredPolicyCheck`. Adding a point
 * without a context here makes `PolicyContext` fail to compile.
 */
type PolicyContexts = {
	workflowSave: WorkflowSaveContext;
	workflowPublish: WorkflowPublishContext;
	workflowStart: WorkflowStartContext;
	workflowTransfer: WorkflowTransferContext;
	credentialDecrypt: CredentialDecryptContext;
	contentImport: ContentImportContext;
};

export type PolicyContext<Point extends EnforcementPoint> = PolicyContexts[Point];

/**
 * What the policy infrastructure module registers into {@link PolicyEnforcementService}.
 *
 * Both modes return a decision; the proxy turns a non-empty one into a `PolicyViolationError`.
 * They're separate methods because the fail posture differs: under `enforce` a check that
 * breaks has to block, while `evaluate` reports it in `checkErrors` and keeps the results of
 * the checks that did run.
 */
export interface PolicyEnforcementBackend {
	enforce<Point extends EnforcementPoint>(
		point: Point,
		context: PolicyContext<Point>,
	): Promise<PolicyDecision>;

	evaluate<Point extends EnforcementPoint>(
		point: Point,
		context: PolicyContext<Point>,
	): Promise<PolicyDecision>;
}
