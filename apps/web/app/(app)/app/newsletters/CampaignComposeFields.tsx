"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  renderBlocksToHtml,
  renderBlocksToText,
  type Block,
  type ButtonBlock,
  type DividerBlock,
  type HeadingBlock,
  type ImageBlock,
  type RawHtmlBlock,
  type TextBlock
} from "@raring2go/marketing/blocks";

function newHeadingBlock(): HeadingBlock {
  return { id: crypto.randomUUID(), type: "heading", text: "", level: 1 };
}
function newTextBlock(): TextBlock {
  return { id: crypto.randomUUID(), type: "text", html: "" };
}
function newImageBlock(): ImageBlock {
  return { id: crypto.randomUUID(), type: "image", src: "", alt: "", href: null, fileId: null };
}
function newButtonBlock(): ButtonBlock {
  return { id: crypto.randomUUID(), type: "button", label: "", href: "" };
}
function newDividerBlock(): DividerBlock {
  return { id: crypto.randomUUID(), type: "divider" };
}

// localStorage draft autosave: a per-browser convenience so an accidental
// refresh or navigation doesn't lose composed content. Not synced across
// devices - server-side draft persistence would be a bigger feature.
const DRAFT_STORAGE_KEY = "raring2go:newsletter-compose-draft";

type StoredDraft = { title: string; subject: string; blocks: Block[] };

function isStoredDraft(value: unknown): value is StoredDraft {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).title === "string" &&
    typeof (value as Record<string, unknown>).subject === "string" &&
    Array.isArray((value as Record<string, unknown>).blocks)
  );
}

function blockHasContent(block: Block): boolean {
  switch (block.type) {
    case "heading":
      return block.text.trim() !== "";
    case "text":
      return block.html.replace(/<[^>]*>/g, "").trim() !== "";
    case "image":
      return block.src.trim() !== "" || block.alt.trim() !== "";
    case "button":
      return block.label.trim() !== "" || block.href.trim() !== "";
    case "divider":
      return false;
    case "raw-html":
      return block.html.trim() !== "";
  }
}

function draftHasContent(draft: StoredDraft): boolean {
  return draft.title.trim() !== "" || draft.subject.trim() !== "" || draft.blocks.some(blockHasContent);
}

function readStoredDraft(): StoredDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isStoredDraft(parsed) && draftHasContent(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export type SuggestSubjectLines = (input: { draftId: string; campaignTitle: string; bodyPreviewText: string }) => Promise<string[]>;
export type SuggestBlockCopy = (input: { draftId: string; blockId: string; campaignTitle: string; existingText?: string | null }) => Promise<string>;
export type AcceptAiSuggestion = (input: { draftId: string; task: "subject_lines" | "block_copy"; blockId?: string; accepted: string }) => Promise<void>;

export type LastNewsletter = { title: string; subject: string; blocks: Block[] };

export function CampaignComposeFields({
  aiAssistAvailable,
  lastNewsletter,
  suggestSubjectLinesAction,
  suggestBlockCopyAction,
  acceptAiSuggestionAction
}: {
  aiAssistAvailable: boolean;
  lastNewsletter?: LastNewsletter;
  suggestSubjectLinesAction: SuggestSubjectLines;
  suggestBlockCopyAction: SuggestBlockCopy;
  acceptAiSuggestionAction: AcceptAiSuggestion;
}) {
  const [draftId] = useState(() => crypto.randomUUID());
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [blocks, setBlocks] = useState<Block[]>(() => [newTextBlock()]);
  const [importHtml, setImportHtml] = useState("");
  const [importSourceLabel, setImportSourceLabel] = useState<string | null>(null);
  const [subjectSuggestions, setSubjectSuggestions] = useState<string[] | null>(null);
  const [subjectSuggestState, setSubjectSuggestState] = useState<"idle" | "loading" | "error">("idle");
  const [subjectSuggestError, setSubjectSuggestError] = useState<string | null>(null);
  const [restoreBanner, setRestoreBanner] = useState<StoredDraft | null>(() => readStoredDraft());
  const [past, setPast] = useState<Block[][]>([]);
  const [future, setFuture] = useState<Block[][]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  // Shared with the submit handler below so a real submit can cancel a
  // still-pending debounced write - otherwise a keystroke within 800ms of
  // clicking submit leaves this timer armed, and it fires shortly after the
  // submit handler clears the draft, silently resurrecting it.
  const autosaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const previewHtml = useMemo(() => renderBlocksToHtml(blocks), [blocks]);

  useEffect(() => {
    if (restoreBanner) return; // wait for the user to restore/discard before autosaving over it
    const handle = setTimeout(() => {
      autosaveTimeoutRef.current = null;
      try {
        window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ title, subject, blocks }));
      } catch {
        // ignore - autosave is a best-effort convenience
      }
    }, 800);
    autosaveTimeoutRef.current = handle;
    return () => {
      clearTimeout(handle);
      if (autosaveTimeoutRef.current === handle) {
        autosaveTimeoutRef.current = null;
      }
    };
  }, [restoreBanner, title, subject, blocks]);

  useEffect(() => {
    const form = rootRef.current?.closest("form");
    if (!form) return;
    const clearDraft = () => {
      // Cancel any debounced write still pending from a keystroke made just
      // before submit - clearing localStorage alone doesn't stop it firing.
      if (autosaveTimeoutRef.current) {
        clearTimeout(autosaveTimeoutRef.current);
        autosaveTimeoutRef.current = null;
      }
      try {
        window.localStorage.removeItem(DRAFT_STORAGE_KEY);
      } catch {
        // ignore
      }
    };
    form.addEventListener("submit", clearDraft);
    return () => form.removeEventListener("submit", clearDraft);
  }, []);

  function restoreDraft() {
    if (!restoreBanner) return;
    setTitle(restoreBanner.title);
    setSubject(restoreBanner.subject);
    setBlocks(restoreBanner.blocks.length > 0 ? restoreBanner.blocks : [newTextBlock()]);
    setRestoreBanner(null);
  }

  function discardDraft() {
    try {
      window.localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch {
      // ignore
    }
    setRestoreBanner(null);
  }

  function startFromLastNewsletter() {
    if (!lastNewsletter) return;
    setTitle(lastNewsletter.title);
    setSubject(lastNewsletter.subject);
    // Fresh ids for every block - never reuse the source campaign's block ids.
    setBlocks(
      lastNewsletter.blocks.length > 0
        ? lastNewsletter.blocks.map((block) => ({ ...block, id: crypto.randomUUID() }) as Block)
        : [newTextBlock()]
    );
  }

  const canStartFromLastNewsletter =
    Boolean(lastNewsletter) && !restoreBanner && !draftHasContent({ title, subject, blocks });

  // Block-level structural undo/redo (add/remove/duplicate/reorder) only -
  // per-keystroke text edits stay owned by native input undo and Tiptap's
  // own history inside the rich-text block.
  const MAX_HISTORY = 50;

  function pushHistory(snapshot: Block[]) {
    setPast((current) => {
      const next = [...current, snapshot];
      return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
    });
    setFuture([]);
  }

  const undo = useCallback(() => {
    if (past.length === 0) return;
    const previous = past[past.length - 1]!;
    setFuture((currentFuture) => [blocks, ...currentFuture]);
    setPast((currentPast) => currentPast.slice(0, -1));
    setBlocks(previous);
  }, [past, blocks]);

  const redo = useCallback(() => {
    if (future.length === 0) return;
    const next = future[0]!;
    setPast((currentPast) => [...currentPast, blocks]);
    setFuture((currentFuture) => currentFuture.slice(1));
    setBlocks(next);
  }, [future, blocks]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      const isUndo = (event.metaKey || event.ctrlKey) && !event.shiftKey && key === "z";
      const isRedo = (event.metaKey || event.ctrlKey) && event.shiftKey && key === "z";
      if (!isUndo && !isRedo) return;

      const active = document.activeElement;
      const isTextEditingContext =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable);

      if (isTextEditingContext) return; // let native input undo / Tiptap's own history handle it

      event.preventDefault();
      if (isRedo) {
        redo();
      } else {
        undo();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo]);

  async function handleSuggestSubjectLines() {
    setSubjectSuggestState("loading");
    setSubjectSuggestError(null);
    try {
      const suggestions = await suggestSubjectLinesAction({
        draftId,
        campaignTitle: title,
        bodyPreviewText: renderBlocksToText(blocks)
      });
      setSubjectSuggestions(suggestions);
      setSubjectSuggestState("idle");
    } catch (error) {
      setSubjectSuggestState("error");
      setSubjectSuggestError(error instanceof Error ? error.message : "Suggestion failed.");
    }
  }

  function acceptSubjectSuggestion(text: string) {
    setSubject(text);
    setSubjectSuggestions(null);
    void acceptAiSuggestionAction({ draftId, task: "subject_lines", accepted: text }).catch(() => {});
  }

  function updateBlock(id: string, patch: Partial<Block>) {
    setBlocks((current) => current.map((block) => (block.id === id ? ({ ...block, ...patch } as Block) : block)));
  }

  function removeBlock(id: string) {
    if (blocks.length <= 1) return;
    pushHistory(blocks);
    setBlocks(blocks.filter((block) => block.id !== id));
  }

  function duplicateBlock(id: string) {
    const index = blocks.findIndex((block) => block.id === id);
    if (index === -1) return;
    pushHistory(blocks);
    const clone = { ...blocks[index], id: crypto.randomUUID() } as Block;
    const next = [...blocks];
    next.splice(index + 1, 0, clone);
    setBlocks(next);
  }

  function addBlock(factory: () => Block) {
    pushHistory(blocks);
    setBlocks([...blocks, factory()]);
  }

  async function handleImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImportHtml(await file.text());
    setImportSourceLabel(file.name);
  }

  function addImportedBlock() {
    if (!importHtml.trim()) return;
    pushHistory(blocks);
    // Deliberately unsanitized here — the server action is the real trust
    // boundary and re-sanitizes every RawHtmlBlock's html before it is stored.
    const block: RawHtmlBlock = { id: crypto.randomUUID(), type: "raw-html", html: importHtml, sourceLabel: importSourceLabel };
    setBlocks([...blocks, block]);
    setImportHtml("");
    setImportSourceLabel(null);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = blocks.findIndex((block) => block.id === active.id);
    const newIndex = blocks.findIndex((block) => block.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    pushHistory(blocks);
    setBlocks(arrayMove(blocks, oldIndex, newIndex));
  }

  return (
    <div className="block-editor" ref={rootRef}>
      {restoreBanner ? (
        <div className="block-editor-draft-banner" role="status">
          <span>You have an unsaved draft saved in this browser.</span>
          <button type="button" onClick={restoreDraft}>
            Restore draft
          </button>
          <button type="button" onClick={discardDraft}>
            Discard
          </button>
        </div>
      ) : null}

      {canStartFromLastNewsletter ? (
        <div className="block-editor-draft-banner" role="status">
          <span>Want a head start? Reuse your last newsletter&apos;s content.</span>
          <button type="button" onClick={startFromLastNewsletter}>
            Start from your last newsletter
          </button>
        </div>
      ) : null}

      <label>
        Title
        <input type="text" name="title" required value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>

      <div className="block-editor-subject-field">
        <label>
          Subject
          <input type="text" name="subject" required value={subject} onChange={(event) => setSubject(event.target.value)} />
        </label>
        {aiAssistAvailable ? (
          <div className="block-editor-ai-assist">
            <button type="button" onClick={handleSuggestSubjectLines} disabled={subjectSuggestState === "loading"}>
              {subjectSuggestState === "loading" ? "Thinking…" : "✨ Suggest subject lines"}
            </button>
            {subjectSuggestError ? <span className="block-editor-error">{subjectSuggestError}</span> : null}
            {subjectSuggestions ? (
              <ul className="block-editor-ai-suggestions">
                {subjectSuggestions.map((suggestion) => (
                  <li key={suggestion}>
                    <button type="button" onClick={() => acceptSubjectSuggestion(suggestion)}>
                      {suggestion}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      <input type="hidden" name="blocksJson" value={JSON.stringify(blocks)} />

      <div className="block-editor-history-controls">
        <button type="button" onClick={undo} disabled={past.length === 0} aria-label="Undo">
          ↶ Undo
        </button>
        <button type="button" onClick={redo} disabled={future.length === 0} aria-label="Redo">
          ↷ Redo
        </button>
      </div>

      <DndContext id="newsletter-compose-blocks" sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={blocks.map((block) => block.id)} strategy={verticalListSortingStrategy}>
          <div className="block-editor-list">
            {blocks.map((block) => (
              <SortableBlockRow
                key={block.id}
                block={block}
                canRemove={blocks.length > 1}
                onChange={(patch) => updateBlock(block.id, patch)}
                onRemove={() => removeBlock(block.id)}
                onDuplicate={() => duplicateBlock(block.id)}
                aiAssistAvailable={aiAssistAvailable}
                draftId={draftId}
                campaignTitle={title}
                suggestBlockCopyAction={suggestBlockCopyAction}
                acceptAiSuggestionAction={acceptAiSuggestionAction}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <div className="block-editor-add-menu">
        <span>Add block:</span>
        <button type="button" onClick={() => addBlock(newHeadingBlock)}>+ Heading</button>
        <button type="button" onClick={() => addBlock(newTextBlock)}>+ Text</button>
        <button type="button" onClick={() => addBlock(newImageBlock)}>+ Image</button>
        <button type="button" onClick={() => addBlock(newButtonBlock)}>+ Button</button>
        <button type="button" onClick={() => addBlock(newDividerBlock)}>+ Divider</button>
      </div>

      <details className="block-editor-import">
        <summary>Import HTML</summary>
        <div className="block-editor-import-fields">
          <label>
            Upload an HTML file
            <input type="file" accept=".html,.htm,.txt" onChange={handleImportFile} />
          </label>
          <label>
            Or paste HTML
            <textarea
              value={importHtml}
              onChange={(event) => {
                setImportHtml(event.target.value);
                setImportSourceLabel(null);
              }}
              rows={4}
              placeholder="Paste an existing newsletter's HTML here"
            />
          </label>
          <button type="button" onClick={addImportedBlock} disabled={!importHtml.trim()}>
            Add imported block
          </button>
          <p className="block-editor-import-note">
            Imported HTML is added as its own block and re-sanitized on the server — scripts, event handlers and unsafe
            links are always stripped, regardless of the source.
          </p>
        </div>
      </details>

      <details className="block-editor-preview">
        <summary>Preview email HTML</summary>
        {/* Local preview of the editor's own in-progress state, not persisted content —
            the server re-sanitizes every text block's HTML before it is ever stored. */}
        <div className="block-editor-preview-frame" dangerouslySetInnerHTML={{ __html: previewHtml }} />
      </details>
    </div>
  );
}

function SortableBlockRow({
  block,
  canRemove,
  onChange,
  onRemove,
  onDuplicate,
  aiAssistAvailable,
  draftId,
  campaignTitle,
  suggestBlockCopyAction,
  acceptAiSuggestionAction
}: {
  block: Block;
  canRemove: boolean;
  onChange: (patch: Partial<Block>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  aiAssistAvailable: boolean;
  draftId: string;
  campaignTitle: string;
  suggestBlockCopyAction: SuggestBlockCopy;
  acceptAiSuggestionAction: AcceptAiSuggestion;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  return (
    <div ref={setNodeRef} style={style} className="block-editor-row">
      <div className="block-editor-row-header">
        <button type="button" className="block-editor-drag-handle" aria-label="Reorder block" {...attributes} {...listeners}>
          ⠿
        </button>
        <span className="block-editor-row-type">{blockLabel(block)}</span>
        <button type="button" onClick={onDuplicate} aria-label="Duplicate block">
          Duplicate
        </button>
        <button type="button" onClick={onRemove} disabled={!canRemove} aria-label="Remove block">
          Remove
        </button>
      </div>
      <BlockFields
        block={block}
        onChange={onChange}
        aiAssistAvailable={aiAssistAvailable}
        draftId={draftId}
        campaignTitle={campaignTitle}
        suggestBlockCopyAction={suggestBlockCopyAction}
        acceptAiSuggestionAction={acceptAiSuggestionAction}
      />
    </div>
  );
}

function blockLabel(block: Block) {
  switch (block.type) {
    case "heading":
      return "Heading";
    case "text":
      return "Text";
    case "image":
      return "Image";
    case "button":
      return "Button";
    case "divider":
      return "Divider";
    case "raw-html":
      return "Imported HTML";
  }
}

type UploadResponse = { fileId: string; src: string; fileName: string; virusScanStatus: string; error?: string };

function ImageBlockFields({ block, onChange }: { block: ImageBlock; onChange: (patch: Partial<Block>) => void }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/files/upload", { method: "POST", body: formData });
      const payload = (await response.json()) as UploadResponse;

      if (!response.ok) {
        setError(payload.error ?? "Upload failed.");
        return;
      }

      onChange({ src: payload.src, fileId: payload.fileId, alt: block.alt || payload.fileName });
    } catch {
      setError("Upload failed. Check your connection and try again.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="block-editor-fields">
      <label className="block-editor-image-upload">
        Upload an image
        <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={handleUpload} disabled={uploading} />
      </label>
      {uploading ? <span className="block-editor-import-note">Uploading…</span> : null}
      {error ? <span className="block-editor-error">{error}</span> : null}
      <input
        type="url"
        value={block.src}
        placeholder="Or paste an image URL (https://...)"
        onChange={(event) => onChange({ src: event.target.value, fileId: null })}
      />
      <input
        type="text"
        value={block.alt}
        placeholder="Alt text"
        onChange={(event) => onChange({ alt: event.target.value })}
      />
      <input
        type="url"
        value={block.href ?? ""}
        placeholder="Link when clicked (optional)"
        onChange={(event) => onChange({ href: event.target.value || null })}
      />
      {block.fileId ? <p className="block-editor-import-note">Uploaded file attached.</p> : null}
    </div>
  );
}

function BlockFields({
  block,
  onChange,
  aiAssistAvailable,
  draftId,
  campaignTitle,
  suggestBlockCopyAction,
  acceptAiSuggestionAction
}: {
  block: Block;
  onChange: (patch: Partial<Block>) => void;
  aiAssistAvailable: boolean;
  draftId: string;
  campaignTitle: string;
  suggestBlockCopyAction: SuggestBlockCopy;
  acceptAiSuggestionAction: AcceptAiSuggestion;
}) {
  switch (block.type) {
    case "heading":
      return (
        <div className="block-editor-fields">
          <input
            type="text"
            value={block.text}
            placeholder="Heading text"
            onChange={(event) => onChange({ text: event.target.value })}
          />
          <select value={block.level} onChange={(event) => onChange({ level: Number(event.target.value) as 1 | 2 })}>
            <option value={1}>Large heading</option>
            <option value={2}>Small heading</option>
          </select>
        </div>
      );
    case "text":
      return (
        <TextBlockEditor
          block={block}
          onChange={onChange}
          aiAssistAvailable={aiAssistAvailable}
          draftId={draftId}
          campaignTitle={campaignTitle}
          suggestBlockCopyAction={suggestBlockCopyAction}
          acceptAiSuggestionAction={acceptAiSuggestionAction}
        />
      );
    case "image":
      return <ImageBlockFields block={block} onChange={onChange} />;
    case "button":
      return (
        <div className="block-editor-fields">
          <input
            type="text"
            value={block.label}
            placeholder="Button label"
            onChange={(event) => onChange({ label: event.target.value })}
          />
          <input
            type="url"
            value={block.href}
            placeholder="Button link (https://...)"
            onChange={(event) => onChange({ href: event.target.value })}
          />
        </div>
      );
    case "divider":
      return null;
    case "raw-html":
      return <p className="block-editor-imported-note">Imported HTML ({block.sourceLabel ?? "pasted"}) — not editable here.</p>;
  }
}

function TextBlockEditor({
  block,
  onChange,
  aiAssistAvailable,
  draftId,
  campaignTitle,
  suggestBlockCopyAction,
  acceptAiSuggestionAction
}: {
  block: TextBlock;
  onChange: (patch: Partial<Block>) => void;
  aiAssistAvailable: boolean;
  draftId: string;
  campaignTitle: string;
  suggestBlockCopyAction: SuggestBlockCopy;
  acceptAiSuggestionAction: AcceptAiSuggestion;
}) {
  const [suggestState, setSuggestState] = useState<"idle" | "loading" | "error">("idle");
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        codeBlock: false,
        code: false,
        horizontalRule: false,
        strike: false,
        link: { openOnClick: false, autolink: true, defaultProtocol: "https" }
      })
    ],
    content: block.html,
    immediatelyRender: false,
    onUpdate: ({ editor: updated }) => onChange({ html: updated.getHTML() })
  });

  async function handleSuggestCopy() {
    if (!editor) return;
    setSuggestState("loading");
    setSuggestError(null);
    try {
      const suggestion = await suggestBlockCopyAction({
        draftId,
        blockId: block.id,
        campaignTitle,
        existingText: editor.getText() || null
      });
      const paragraph = `<p>${escapeHtml(suggestion)}</p>`;
      if (editor.isEmpty) {
        editor.commands.setContent(paragraph);
      } else {
        editor.chain().focus("end").insertContent(paragraph).run();
      }
      void acceptAiSuggestionAction({ draftId, task: "block_copy", blockId: block.id, accepted: suggestion }).catch(() => {});
      setSuggestState("idle");
    } catch (error) {
      setSuggestState("error");
      setSuggestError(error instanceof Error ? error.message : "Suggestion failed.");
    }
  }

  return (
    <div className="block-editor-fields">
      {editor ? (
        <div className="block-editor-richtext-toolbar">
          <button type="button" onClick={() => editor.chain().focus().toggleBold().run()} aria-pressed={editor.isActive("bold")}>
            B
          </button>
          <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()} aria-pressed={editor.isActive("italic")}>
            I
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            aria-pressed={editor.isActive("bulletList")}
          >
            • List
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            aria-pressed={editor.isActive("orderedList")}
          >
            1. List
          </button>
          <button
            type="button"
            onClick={() => {
              const url = window.prompt("Link URL");
              if (url) editor.chain().focus().setLink({ href: url }).run();
            }}
            aria-pressed={editor.isActive("link")}
          >
            Link
          </button>
          {aiAssistAvailable ? (
            <button type="button" onClick={handleSuggestCopy} disabled={suggestState === "loading"}>
              {suggestState === "loading" ? "Thinking…" : "✨ Suggest copy"}
            </button>
          ) : null}
        </div>
      ) : null}
      <EditorContent editor={editor} className="block-editor-richtext" />
      {suggestError ? <span className="block-editor-error">{suggestError}</span> : null}
    </div>
  );
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
