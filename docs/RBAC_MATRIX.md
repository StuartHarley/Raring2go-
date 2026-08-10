# RBAC Matrix

Permissions are defaults. Super Admin can edit policies without deployment. Scope and field-level constraints are evaluated in addition to action permission.

| Module | Parent/Public | Advertiser | Franchise Staff | Franchisee | HQ | Super Admin |
|---|---|---|---|---|---|---|
| Franchise Hub | - | - | - | V/E own staff & obligations | V/E own territory | V/C/E/A network | X |
| Advertiser CRM | - | V own portal | V/E assigned | V/C/E/A own territory | V/C/E/A own territory | V/C/E/A network | X |
| Edition Studio | V published | V campaign proofs | V/E assigned | V/E/A local | V/E/A/P local | V/C/E/A/P network | X |
| Templates | - | - | V | V | V permitted | V/C/E/A/P | X |
| Audience CRM | V own | - | V/E scoped | V/E local | V/E local | V/C/E/A network | X |
| Email | preferences | campaign notices | Draft scoped | Draft/send if granted | Draft/send local | C/E/A/P network | X |
| Finance | - | V/pay own | V if granted | V/C if granted | V/C/F local | V/C/A/F network | X |
| Royalties | - | - | - | V if granted | V own statement | V/C/E/A network | X |
| Agreements | - | - | - | V permitted | V/sign own | V/C/E/A/sign | X |
| Roles & permissions | - | - | - | manage local staff grants | limited local grants | delegated admin | X |

## Permission dimensions
- Actions: hidden, view, create, edit, approve, publish/send, export, delete, administer.
- Scope: own record, own organisation, own advertiser, own territory, selected territories, regional group, whole network, system.
- Special constraints: financial visibility/credit/refunds; editorial/template/preflight override; communications send limits; contract view/prepare/approve/sign; field masking; temporary delegation.