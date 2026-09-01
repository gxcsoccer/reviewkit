import { useCallback, useState } from "react";
import { ActionReview, jsonRenderer, tableRenderer, textRenderer } from "@reviewkit/react";
import type { ExecutionReceipt, ExecutionRequest, ReviewDecision } from "@reviewkit/core";
import { SCHEMA_VERSION } from "@reviewkit/core";
import { sampleProposal } from "./sample";

export default function App() {
  const [log, setLog] = useState("Waiting for a decision.");

  const onDecision = useCallback(async (decision: ReviewDecision) => {
    setLog("Decision " + decision.kind + " bound to hash " + decision.approvedContentHash);
  }, []);

  const onRequestExecution = useCallback(async (request: ExecutionRequest): Promise<ExecutionReceipt> => {
    setLog("Host executing request " + request.id + " (ReviewKit did not call any API).");
    return {
      schemaVersion: SCHEMA_VERSION,
      id: "rcp_demo",
      proposalId: request.proposalId,
      proposalVersion: request.proposalVersion,
      decisionId: request.decisionId,
      requestId: request.id,
      idempotencyKey: request.idempotencyKey,
      executedParamsHash: request.payloadHash,
      status: "succeeded",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      results: request.payload.items.map((item) => ({ itemId: item.id, status: "succeeded" as const })),
    };
  }, []);

  return (
    <div className="demo">
      <header className="demo__hero">
        <p className="demo__kicker">ReviewKit v0.1 Alpha</p>
        <h1>Pull requests for agent actions</h1>
        <p className="demo__lede">The host executes. ReviewKit never does.</p>
        <p className="demo__log" role="status">{log}</p>
      </header>
      <ActionReview
        proposal={sampleProposal}
        renderers={[jsonRenderer(), textRenderer(), tableRenderer()]}
        onDecision={onDecision}
        onRequestExecution={onRequestExecution}
      />
    </div>
  );
}
