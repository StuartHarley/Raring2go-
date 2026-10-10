import Link from "next/link";
import type { Route } from "next";
import { requireShellPermission } from "../../../../../../lib/app-shell";
import { readFlatplan } from "../../../../../../lib/edition-runtime";
import { readEditionInventory } from "../../../../../../lib/edition-inventory";
import { formatCount, formatLabel } from "../../../../../../lib/format";
import { Actions, EmptyState, LinkButton, Notice, PageHeader, Panel, RecordCard, RecordList } from "../../../../../../lib/page-ui";
import { recordOutcome } from "../../../../../../lib/protected-outcome";
import { Breadcrumbs } from "../../../../../../lib/workflow-ui";
import { requestFromSearchParamsAndCookies } from "../../../page";
import { assignPageAction, createContentAction, createSlotsAction, movePageAction, retireSlotAction } from "./actions";

export const metadata = { title: "Flatplan" };

const banners: Record<string, string> = {
  page_saved: "Page saved.",
  page_moved: "Page moved.",
  content_created: "Content added to this edition. Assign it to a page below.",
  page_refused: "That page could not be changed. It may be locked, or the template or content is not available for this edition.",
  move_refused: "That page cannot move there. Locked pages stay where they are.",
  content_refused: "That content could not be added. Give it a title and a type.",
  slots_created: "Advertiser slots are on sale for the chosen pages.",
  slots_exist: "Those pages already had that slot.",
  slots_refused: "Those slots could not be created. A page may be locked, hold editorial content, or already carry a different kind of advertisement.",
  slot_retired: "Slot taken off sale.",
  slot_refused: "Only an unsold slot can be taken off sale."
};

const contentTypes = ["article", "event", "offer", "competition", "advertorial", "house_page"];

export default async function FlatplanPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const search = await searchParams;
  const { id } = await params;
  const request = await requestFromSearchParamsAndCookies(search);
  const code = Array.isArray(search.result) ? search.result[0] : search.result;
  const result = await loadFlatplan(request, id);

  if ("error" in result) {
    return recordOutcome(result.error);
  }

  const { plan, inventory, canEdit, canAddContent, canManageSlots } = result;
  const message = code ? banners[code] : undefined;
  const isError = Boolean(code?.endsWith("_refused"));
  const frozen = ["published", "approved"].includes(plan.edition.status);
  const slotsOnPage = (pageNumber: number) => inventory?.slots.filter((slot) => slot.pageNumber === pageNumber) ?? [];

  return (
    <>
      <Breadcrumbs items={[{ label: "Edition Factory", href: "/app/editions" as Route }, { label: plan.edition.title, href: `/app/editions/${id}` as Route }, { label: "Flatplan" }]} />
      <PageHeader
        eyebrow="Flatplan"
        title={plan.edition.title}
        intro={`Assign a published template and content to each page, and put the pages in order. Locked pages (such as the cover) cannot be moved or changed from a territory.${
          frozen ? ` The edition is ${formatLabel(plan.edition.status).toLowerCase()}: reopen it from the edition page to change pages.` : ""
        }`}
        actions={
          <LinkButton href={`/app/editions/${id}` as Route} variant="secondary">
            Back to the edition
          </LinkButton>
        }
      />

      {message ? <Notice tone={isError ? "error" : "success"}>{message}</Notice> : null}

      <Panel eyebrow="Pages" title="Page order and content">
        {plan.pages.length === 0 ? (
          <EmptyState title="No flatplan yet">Create it from the edition page, then come back here to assign templates and content.</EmptyState>
        ) : (
          <RecordList>
            {plan.pages.map(({ page, templateName, contentTitle }, index) => (
              <div key={page.id} id={`page-${page.id}`}>
                <RecordCard
                  title={
                    <Link href={`/app/editions/${id}/pages/${page.id}` as Route}>
                      Page {page.pageNumber}
                    </Link>
                  }
                  status={page.status}
                  lines={[
                    `${formatLabel(page.side)} page${page.locked ? " · Locked" : ""}`,
                    `${templateName ?? "No template"} · ${contentTitle ?? "No content"}`,
                    slotsOnPage(page.pageNumber).length > 0
                      ? `Advertising: ${slotsOnPage(page.pageNumber)
                          .map((slot) => `${slot.productName} (${formatLabel(slot.status).toLowerCase()})`)
                          .join(", ")}`
                      : null
                  ]}
                >
                  {canEdit && !frozen && !page.locked ? (
                    <>
                      <form action={assignPageAction.bind(null, request, id, page.id)} className="franchise-form">
                        <label>
                          Template
                          <select name="templateVersionId" defaultValue={page.templateVersionId ?? ""}>
                            <option value="">Keep current</option>
                            {plan.templates.map((template) => (
                              <option key={template.id} value={template.id}>
                                {template.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Content
                          <select name="assignedContentId" defaultValue={page.assignedContentId ?? ""}>
                            <option value="">Keep current</option>
                            {plan.content.map((entry) => (
                              <option key={entry.id} value={entry.id}>
                                {entry.title}
                                {entry.usedOnPage && entry.usedOnPage !== page.pageNumber ? ` (on page ${entry.usedOnPage})` : ""}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button type="submit" className="r2-button r2-button--primary">
                          Save page {page.pageNumber}
                        </button>
                      </form>
                      <Actions>
                        <form action={movePageAction.bind(null, request, id, page.id, "up")}>
                          <button type="submit" className="r2-button r2-button--secondary" disabled={index === 0}>
                            Move up
                          </button>
                        </form>
                        <form action={movePageAction.bind(null, request, id, page.id, "down")}>
                          <button type="submit" className="r2-button r2-button--secondary" disabled={index === plan.pages.length - 1}>
                            Move down
                          </button>
                        </form>
                      </Actions>
                    </>
                  ) : null}
                </RecordCard>
              </div>
            ))}
          </RecordList>
        )}
      </Panel>

      <Panel
        id="advertising"
        eyebrow="Advertising"
        title="Advertiser slots"
        intro="The pages advertisers can book. A slot belongs to its page, so moving the page moves the slot and any booking with it. A page with editorial content, a locked page or an HQ page cannot carry one."
      >
        {inventory && inventory.slots.length > 0 ? (
          <RecordList>
            {inventory.slots.map((slot) => (
              <RecordCard key={slot.id} title={`Page ${slot.pageNumber ?? "?"}: ${slot.productName}`} status={slot.status} tone={slot.status === "available" ? "info" : undefined}>
                {canManageSlots && !frozen && slot.status === "available" ? (
                  <form action={retireSlotAction.bind(null, request, id, slot.id)}>
                    <button type="submit" className="r2-button r2-button--secondary">
                      Take off sale
                    </button>
                  </form>
                ) : null}
              </RecordCard>
            ))}
          </RecordList>
        ) : (
          <EmptyState title="No slots on sale yet">Put a product on sale for one or more eligible pages below.</EmptyState>
        )}
        {inventory && canManageSlots && !frozen && inventory.products.length > 0 ? (
          <form action={createSlotsAction.bind(null, request, id)} className="franchise-form">
            <label>
              Product
              <select name="productId" required>
                {inventory.products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
            </label>
            <fieldset>
              <legend>Pages</legend>
              {inventory.pages.map((candidate) => (
                <label key={candidate.id}>
                  <input type="checkbox" name="pageIds" value={candidate.id} disabled={!candidate.eligible || candidate.sold} /> Page {candidate.pageNumber}
                  {candidate.reason ? ` (${candidate.reason})` : candidate.sold ? " (on sale)" : ""}
                </label>
              ))}
            </fieldset>
            <button type="submit" className="r2-button r2-button--primary">
              Put on sale
            </button>
          </form>
        ) : null}
      </Panel>

      <Panel id="content" eyebrow="Content" title={`Content in this edition (${formatCount(plan.content.length, "item")})`}>
        {plan.content.length === 0 ? (
          <EmptyState title="No content in this edition yet">Inherited master content and anything you add locally appears here.</EmptyState>
        ) : (
          <RecordList>
            {plan.content.map((entry) => (
              <RecordCard
                key={entry.id}
                title={entry.title}
                status={entry.state}
                lines={[entry.locked ? "Locked" : null, entry.usedOnPage ? `On page ${entry.usedOnPage}` : "Not placed on a page yet"]}
              />
            ))}
          </RecordList>
        )}
        {canAddContent && !frozen ? (
          <form action={createContentAction.bind(null, request, id)} className="franchise-form">
            <h3>Add local content</h3>
            <label>
              Title
              <input name="title" required maxLength={200} />
            </label>
            <label>
              Type
              <select name="contentType" defaultValue="article">
                {contentTypes.map((type) => (
                  <option key={type} value={type}>
                    {formatLabel(type)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Headline
              <input name="headline" maxLength={300} />
            </label>
            <label>
              Body
              <textarea name="body" rows={5} maxLength={20000} />
            </label>
            <button type="submit" className="r2-button r2-button--primary">
              Add content
            </button>
          </form>
        ) : null}
      </Panel>
    </>
  );
}

async function loadFlatplan(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>, editionId: string) {
  try {
    const shell = await requireShellPermission(request, { module: "edition", action: "view" });
    const actor = { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId };
    const plan = await readFlatplan(actor, editionId);
    const canEdit = await requireShellPermission(request, { module: "edition.page", action: "edit" }).then(() => true, () => false);
    const canAddContent = await requireShellPermission(request, { module: "edition.content", action: "edit_local" }).then(() => true, () => false);
    const canManageSlots = await requireShellPermission(request, { module: "advertiser.inventory", action: "manage" }).then(() => true, () => false);
    const inventory = await readEditionInventory(actor, editionId).catch(() => null);
    return { plan, inventory, canEdit, canAddContent, canManageSlots };
  } catch (error) {
    return { error };
  }
}
