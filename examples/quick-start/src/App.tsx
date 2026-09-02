import { useCallback, useState } from "react";
import {
  ActionReview,
  ReviewKitProvider,
  jsonRenderer,
  tableRenderer,
  textRenderer,
} from "@reviewkit/react";
import type { ExecutionReceipt, ExecutionRequest, ReviewDecision } from "@reviewkit/core";
import { SCHEMA_VERSION } from "@reviewkit/core";
import { SAMPLE_SHA, SAMPLE_VERSION, sampleProposal } from "./sample";

export default function App() {
  const [log, setLog] = useState("等待审阅决定。主机执行，界面不直连 CRM。");

  const onDecision = useCallback(async (decision: ReviewDecision) => {
    setLog("决定 " + decision.kind + " · 绑定哈希 " + decision.approvedContentHash);
  }, []);

  const onRequestExecution = useCallback(async (request: ExecutionRequest): Promise<ExecutionReceipt> => {
    setLog("主机执行请求 " + request.id + "（ReviewKit 未调用任何 API）。");
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
    <div className="studio">
      <aside className="hash-rail" aria-label="bound hash">
        <div className="hash-rail__tick" />
        <div className="hash-rail__mark">REDLINE · v{SAMPLE_VERSION}</div>
        <div className="hash-rail__sha">{SAMPLE_SHA}</div>
      </aside>
      <div className="demo">
        <header className="demo__hero">
          <p className="demo__kicker">Redline Studio</p>
          <p className="demo__brand">
            REVIEW<em>KIT</em> · host executes
          </p>
          <h1>Pull requests for agent actions</h1>
          <p className="demo__lede">哈希即契约。主机执行，界面不直连 HubSpot。</p>
          <p className="demo__log" role="status">
            {log}
          </p>
        </header>
        <ReviewKitProvider theme="dark" locale="zh-CN">
          <ActionReview
            proposal={sampleProposal}
            renderers={[textRenderer(), tableRenderer(), jsonRenderer()]}
            onDecision={onDecision}
            onRequestExecution={onRequestExecution}
          />
        </ReviewKitProvider>
      </div>
    </div>
  );
}
