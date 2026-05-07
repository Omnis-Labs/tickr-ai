import type {
  DecodedSolanaError,
  DiagnosticStatus,
  LogDiagnostic,
} from '@/lib/dev-tools/client-diagnostics';
import type { JupiterSwapDebug } from './ultra-swap';

function shortAddress(value: string): string {
  if (value.length <= 12) return value;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function statusForAge(bucket: JupiterSwapDebug['orderAgeBucket']): DiagnosticStatus {
  if (bucket === 'healthy') return 'healthy';
  if (bucket === 'warn') return 'watch';
  if (bucket === 'risk' || bucket === 'refresh-recommended') return 'risk';
  return 'unknown';
}

export function diagnosticsFromSwapDebug(
  debug: JupiterSwapDebug,
  decoded?: DecodedSolanaError | null,
): LogDiagnostic[] {
  const diagnostics: LogDiagnostic[] = [];
  const ageMs = debug.orderAgeMsAtBroadcast;
  diagnostics.push({
    hypothesis: 'Blockhash age',
    status: statusForAge(debug.orderAgeBucket),
    detail:
      ageMs == null
        ? 'No broadcast start timestamp captured.'
        : `${ageMs}ms from Jupiter order to Ultra execute (${debug.orderAgeBucket}).`,
  });

  const validity = debug.blockhashValidity ?? [];
  const primary = validity.find((item) => item.isPrivyPrimary);
  const anyValid = validity.some((item) => item.valid === true);
  const anyInvalid = validity.some((item) => item.valid === false);
  diagnostics.push({
    hypothesis: 'RPC freshness',
    status:
      validity.length === 0
        ? 'unknown'
        : primary?.valid === false || (anyInvalid && anyValid)
          ? 'risk'
          : validity.some((item) => item.error)
            ? 'watch'
            : 'healthy',
    detail:
      validity.length === 0
        ? `No blockhash validity probe ran. Privy primary: ${debug.selectedPrivyRpc ?? 'unknown'}.`
        : validity
            .map((item) => {
              const result =
                item.valid == null
                  ? `error: ${item.error ?? 'unknown'}`
                  : item.valid
                    ? 'valid'
                    : 'invalid';
              return `${item.isPrivyPrimary ? 'primary ' : ''}RPC${item.index + 1} ${result} (${item.latencyMs}ms)`;
            })
            .join('; '),
  });

  const simulations = debug.preBroadcastSimulation ?? [];
  const simulationHasErr = simulations.some((item) => item.err);
  const simulationHasTransportError = simulations.some((item) => item.error);
  diagnostics.push({
    hypothesis: 'Local pre-submit simulation',
    status:
      simulations.length === 0
        ? 'unknown'
        : simulationHasErr
          ? 'risk'
          : simulationHasTransportError
            ? 'watch'
            : 'healthy',
    detail:
      simulations.length === 0
        ? 'No unsigned simulation was captured before submit.'
        : simulations
            .map((item) => {
              if (item.error) return `RPC${item.index + 1} transport error: ${item.error}`;
              if (item.err) return `RPC${item.index + 1} simulation err: ${item.err}`;
              return `RPC${item.index + 1} ok (${item.unitsConsumed ?? 'n/a'} units, ${item.logsCount ?? 0} logs)`;
            })
            .join('; '),
  });

  const shape = debug.transactionShape;
  const signedShape = debug.signedTransactionShape;
  const takerIsSigner = !!debug.taker && !!shape?.signerKeys.includes(debug.taker);
  const signedNonZeroCount = signedShape
    ? signedShape.signatureCount - signedShape.zeroSignatureCount
    : null;
  diagnostics.push({
    hypothesis: 'Transaction shape',
    status: !shape || !takerIsSigner ? 'risk' : signedNonZeroCount === 0 ? 'risk' : 'healthy',
    detail: shape
      ? `v${shape.version}, unsigned zeros ${shape.zeroSignatureCount}/${shape.signatureCount}, signed zeros ${signedShape ? `${signedShape.zeroSignatureCount}/${signedShape.signatureCount}` : 'n/a'}, required ${shape.requiredSignatures}, staticKeys ${shape.staticAccountKeys}, ALTs ${shape.addressTableLookups}, ix ${shape.compiledInstructions}, feePayer=${shortAddress(shape.feePayer ?? 'unknown')}, takerSigner=${takerIsSigner}.`
      : 'No transaction shape captured.',
  });

  diagnostics.push({
    hypothesis: 'Privy sign / Ultra execute path',
    status:
      debug.signature || debug.executeStatus === 'Success'
        ? 'healthy'
        : debug.phase === 'sign' || debug.phase === 'execute' || decoded?.code === -32002
          ? 'risk'
          : 'watch',
    detail: debug.signature
      ? `Jupiter Ultra returned signature ${shortAddress(debug.signature)}.`
      : `No signature returned; failed during ${debug.phase}${debug.executeError ? ` (${debug.executeError})` : ''}.`,
  });

  diagnostics.push({
    hypothesis: 'Jupiter order/route',
    status: debug.orderRequestId ? 'healthy' : debug.phase === 'order' ? 'risk' : 'unknown',
    detail: debug.orderRequestId
      ? `Ultra order ${debug.orderRequestId}; impact ${debug.priceImpactPct ?? 'n/a'}.`
      : 'No Ultra order id captured.',
  });

  if (debug.sellBalance) {
    const capped =
      debug.sellBalance.requestedRaw != null &&
      debug.sellBalance.requestedRaw !== debug.sellBalance.submittedRaw;
    diagnostics.push({
      hypothesis: 'Wallet balance / sell amount',
      status: capped ? 'watch' : 'healthy',
      detail: capped
        ? `Requested ${debug.sellBalance.requestedRaw}, wallet had ${debug.sellBalance.walletRaw}, submitted ${debug.sellBalance.submittedRaw}.`
        : `Submitted sell amount ${debug.sellBalance.submittedRaw}; wallet raw ${debug.sellBalance.walletRaw}.`,
    });
  } else {
    diagnostics.push({
      hypothesis: 'Amount and mint mapping',
      status: debug.inputMint && debug.outputMint && debug.amount ? 'healthy' : 'risk',
      detail: `${debug.direction} ${debug.amount ?? 'unknown'} raw from ${shortAddress(debug.inputMint ?? 'unknown')} to ${shortAddress(debug.outputMint ?? 'unknown')}.`,
    });
  }

  if (decoded) {
    diagnostics.push({
      hypothesis: 'Program execution reached?',
      status:
        decoded.code === -32002 &&
        decoded.context.logs === '[]' &&
        (decoded.context.unitsConsumed === '0n' || decoded.context.unitsConsumed === '0')
          ? 'risk'
          : 'watch',
      detail: `${decoded.classifier}; logs=${decoded.context.logs ?? 'n/a'}, units=${decoded.context.unitsConsumed ?? 'n/a'}.`,
    });
  }

  return diagnostics;
}
