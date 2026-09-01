import type { ProposalInput } from "@reviewkit/core";

export const sampleProposal: ProposalInput = {
  type: "crm.contact.update",
  summary: "Raise priority for 3 contacts with recent activity",
  reason: "All three replied to the September campaign.",
  risk: { level: "low", tags: ["bulk_write"] },
  target: { system: "crm", resource: "contacts", environment: "production", sourceVersion: "snap-1" },
  evidence: [{ label: "Campaign replies", ref: "evt_batch_8291" }],
  before: [
    { id: "c_1", name: "Alice", priority: "low" },
    { id: "c_2", name: "Bob", priority: "low" },
    { id: "c_3", name: "Cleo", priority: "medium" },
  ],
  after: [
    { id: "c_1", name: "Alice", priority: "high" },
    { id: "c_2", name: "Bob", priority: "high" },
    { id: "c_3", name: "Cleo", priority: "high" },
  ],
};
