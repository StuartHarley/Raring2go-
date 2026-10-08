export const automationCapabilities = {
  taskView: { module: "automation.task", action: "view" },
  taskComplete: { module: "automation.task", action: "complete" },
  approvalView: { module: "automation.approval", action: "view" },
  approvalDecide: { module: "automation.approval", action: "decide" },
  workflowView: { module: "automation.workflow", action: "view" },
  workflowManage: { module: "automation.workflow", action: "manage" },
  workflowActivate: { module: "automation.workflow", action: "activate" },
  workflowTest: { module: "automation.workflow", action: "test" }
} as const;

export type AutomationCapability = keyof typeof automationCapabilities;
