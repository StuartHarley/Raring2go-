export const financeCapabilities = {
  royaltyRuleView: { module: "finance.royalty_rule", action: "view" },
  royaltyRuleManage: { module: "finance.royalty_rule", action: "manage" },
  royaltyStatementView: { module: "finance.royalty_statement", action: "view" },
  royaltyStatementGenerate: { module: "finance.royalty_statement", action: "generate" },
  royaltyStatementAdjust: { module: "finance.royalty_statement", action: "adjust" },
  royaltyStatementSubmit: { module: "finance.royalty_statement", action: "submit" },
  royaltyStatementApprove: { module: "finance.royalty_statement", action: "approve" }
} as const;

export type FinanceCapability = keyof typeof financeCapabilities;
