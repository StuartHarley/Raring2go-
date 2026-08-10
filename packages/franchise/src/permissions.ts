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
  }
} as const;
