export const franchiseCapabilities = {
  view: {
    module: "franchise",
    action: "view"
  },
  create: {
    module: "franchise",
    action: "create"
  },
  edit: {
    module: "franchise",
    action: "edit"
  },
  agreementView: {
    module: "franchise.agreement",
    action: "view"
  },
  agreementGenerate: {
    module: "franchise.agreement",
    action: "generate"
  },
  agreementSubmitApproval: {
    module: "franchise.agreement",
    action: "submit_approval"
  },
  agreementApprove: {
    module: "franchise.agreement",
    action: "approve"
  },
  agreementVoid: {
    module: "franchise.agreement",
    action: "void"
  },
  agreementSendSignature: {
    module: "franchise.agreement",
    action: "send_signature"
  },
  agreementCancelSignature: {
    module: "franchise.agreement",
    action: "cancel_signature"
  },
  agreementResendSignature: {
    module: "franchise.agreement",
    action: "resend_signature"
  },
  agreementViewSignatureStatus: {
    module: "franchise.agreement",
    action: "view_signature_status"
  },
  agreementRecordSignatureEvent: {
    module: "franchise.agreement",
    action: "record_signature_event"
  },
  agreementDownloadExecuted: {
    module: "franchise.agreement",
    action: "download_executed"
  },
  documentView: {
    module: "franchise.document",
    action: "view"
  },
  documentUpload: {
    module: "franchise.document",
    action: "upload"
  },
  documentDownload: {
    module: "franchise.document",
    action: "download"
  },
  documentArchive: {
    module: "franchise.document",
    action: "archive"
  },
  complianceView: {
    module: "franchise.compliance",
    action: "view"
  },
  complianceManageRequirements: {
    module: "franchise.compliance",
    action: "manage_requirements"
  },
  complianceSubmitEvidence: {
    module: "franchise.compliance",
    action: "submit_evidence"
  },
  complianceVerify: {
    module: "franchise.compliance",
    action: "verify"
  },
  complianceManageActions: {
    module: "franchise.compliance",
    action: "manage_actions"
  },
  complianceViewNetwork: {
    module: "franchise.compliance",
    action: "view_network"
  },
  onboardingView: {
    module: "franchise.onboarding",
    action: "view"
  },
  onboardingManage: {
    module: "franchise.onboarding",
    action: "manage"
  },
  onboardingTemplateManage: {
    module: "franchise.onboarding",
    action: "template_manage"
  },
  onboardingTaskComplete: {
    module: "franchise.onboarding",
    action: "task_complete"
  },
  onboardingTaskAssign: {
    module: "franchise.onboarding",
    action: "task_assign"
  },
  onboardingApproveMilestone: {
    module: "franchise.onboarding",
    action: "approve_milestone"
  },
  onboardingApproveLaunch: {
    module: "franchise.onboarding",
    action: "approve_launch"
  }
} as const;
