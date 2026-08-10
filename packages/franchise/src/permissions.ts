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
  }
} as const;
