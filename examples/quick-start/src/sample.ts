import type { ProposalInput } from "@reviewkit/core";

export const SAMPLE_SHA =
  "sha256:a7f3c91e2b4d8e0f6c1a90b5d3e7f2148c0a6b9e1d5f3a7c2e8b4d0f6a1c9e35";
export const SAMPLE_VERSION = 3;

const batchBefore = [
  { id: "c_4829101", name: "Mara Chen", owner: "高 浪", priority: "low", nextStep: "跟进九月活动回复" },
  { id: "c_4829108", name: "Jonas Veld", owner: "陈玛拉", priority: "medium", nextStep: "德区报价复核" },
  { id: "c_4829114", name: "Priya Natarajan", owner: "高 浪", priority: "low", nextStep: "安排产品演示" },
  { id: "c_4829120", name: "Henrik Dahl", owner: "陈玛拉", priority: "medium", nextStep: "修正邮箱拼写" },
  { id: "c_4829133", name: "Aisha Rahman", owner: "高 浪", priority: "high", nextStep: "续约谈判" },
  { id: "c_4829155", name: "Lucia Moretti", owner: "陈玛拉", priority: "low", nextStep: "意区跟进" },
  { id: "c_4829162", name: "Sam Okonkwo", owner: "高 浪", priority: "medium", nextStep: "确认 E.164 号码" },
  { id: "c_4829170", name: "Elena Voss", owner: "陈玛拉", priority: "low", nextStep: "合规问卷" },
  { id: "c_4829178", name: "Wei Zhang", owner: "高 浪", priority: "medium", nextStep: "Q3 复盘" },
];

const batchAfter = [
  { id: "c_4829101", name: "Mara Chen", owner: "高 浪", priority: "high", nextStep: "本周内回拨" },
  { id: "c_4829108", name: "Jonas Veld", owner: "陈玛拉", priority: "high", nextStep: "发出德区报价" },
  { id: "c_4829114", name: "Priya Natarajan", owner: "高 浪", priority: "medium", nextStep: "锁定演示档期" },
  { id: "c_4829120", name: "Henrik Dahl", owner: "陈玛拉", priority: "medium", nextStep: "邮箱 henrik@acme.com 已核" },
  { id: "c_4829133", name: "Aisha Rahman", owner: "高 浪", priority: "high", nextStep: "发送续约草案" },
  { id: "c_4829155", name: "Lucia Moretti", owner: "陈玛拉", priority: "medium", nextStep: "意区电话跟进" },
  { id: "c_4829162", name: "Sam Okonkwo", owner: "高 浪", priority: "high", nextStep: "号码写入 E.164" },
  { id: "c_4829170", name: "Elena Voss", owner: "陈玛拉", priority: "medium", nextStep: "收回合规问卷" },
  { id: "c_4829178", name: "Wei Zhang", owner: "高 浪", priority: "medium", nextStep: "安排 Q3 复盘会" },
];

export const sampleProposal: ProposalInput = {
  type: "crm.contact.update",
  summary: "Normalize 10 HubSpot contacts — priority, next step, one owner move",
  reason:
    "九月活动回复后需要抬升优先级并写下下一步。Theo Park 的所有人从 Aisha Rahman 改到陈玛拉：这是高风险所有人迁移，不能随 Select all 批量批准。界面不持有 CRM 令牌，由主机执行。",
  risk: {
    level: "high",
    tags: ["bulk_write", "owner_reassign"],
    note: "One owner reassignment is excluded from bulk approve.",
  },
  target: {
    system: "crm",
    resource: "contacts",
    environment: "production",
    sourceVersion: "snap-hs-2041-v3",
  },
  evidence: [
    { label: "Campaign replies", ref: "evt_batch_8291", snippet: "created ≥ 2026-08-01" },
    { label: "Owner policy", ref: "policy.high_risk", snippet: "owner_reassign cannot ride Select all" },
  ],
  items: [
    {
      id: "batch_priority",
      kind: "table",
      summary: "9 contacts: priority and next step (owners unchanged)",
      before: batchBefore,
      after: batchAfter,
      risk: { level: "low", tags: ["priority"] },
    },
    {
      id: "c_4829140",
      kind: "json",
      summary: "Theo Park · owner Aisha Rahman → 陈玛拉",
      before: {
        id: "c_4829140",
        name: "Theo Park",
        owner: "Aisha Rahman",
        priority: "medium",
        nextStep: "EMEA 交接",
      },
      after: {
        id: "c_4829140",
        name: "Theo Park",
        owner: "陈玛拉",
        priority: "high",
        nextStep: "所有人变更后交接 EMEA",
      },
      risk: {
        level: "high",
        tags: ["owner_reassign"],
        note: "Owner write is irreversible on host.",
      },
    },
  ],
};
