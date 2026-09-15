"use client";

import { useMemo, useState } from "react";
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
import { renderBlocksToHtml, type Block, type ButtonBlock, type DividerBlock, type HeadingBlock, type ImageBlock, type TextBlock } from "@raring2go/marketing/blocks";

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

export function BlockEditor() {
  const [blocks, setBlocks] = useState<Block[]>(() => [newTextBlock()]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const previewHtml = useMemo(() => renderBlocksToHtml(blocks), [blocks]);

  function updateBlock(id: string, patch: Partial<Block>) {
    setBlocks((current) => current.map((block) => (block.id === id ? ({ ...block, ...patch } as Block) : block)));
  }

  function removeBlock(id: string) {
    setBlocks((current) => (current.length > 1 ? current.filter((block) => block.id !== id) : current));
  }

  function addBlock(factory: () => Block) {
    setBlocks((current) => [...current, factory()]);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setBlocks((current) => {
      const oldIndex = current.findIndex((block) => block.id === active.id);
      const newIndex = current.findIndex((block) => block.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return current;
      return arrayMove(current, oldIndex, newIndex);
    });
  }

  return (
    <div className="block-editor">
      <input type="hidden" name="blocksJson" value={JSON.stringify(blocks)} />

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={blocks.map((block) => block.id)} strategy={verticalListSortingStrategy}>
          <div className="block-editor-list">
            {blocks.map((block) => (
              <SortableBlockRow
                key={block.id}
                block={block}
                canRemove={blocks.length > 1}
                onChange={(patch) => updateBlock(block.id, patch)}
                onRemove={() => removeBlock(block.id)}
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
  onRemove
}: {
  block: Block;
  canRemove: boolean;
  onChange: (patch: Partial<Block>) => void;
  onRemove: () => void;
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
        <button type="button" onClick={onRemove} disabled={!canRemove} aria-label="Remove block">
          Remove
        </button>
      </div>
      <BlockFields block={block} onChange={onChange} />
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

function BlockFields({ block, onChange }: { block: Block; onChange: (patch: Partial<Block>) => void }) {
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
      return <TextBlockEditor block={block} onChange={onChange} />;
    case "image":
      return (
        <div className="block-editor-fields">
          <input
            type="url"
            value={block.src}
            placeholder="Image URL (https://...)"
            onChange={(event) => onChange({ src: event.target.value })}
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
        </div>
      );
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

function TextBlockEditor({ block, onChange }: { block: TextBlock; onChange: (patch: Partial<Block>) => void }) {
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
        </div>
      ) : null}
      <EditorContent editor={editor} className="block-editor-richtext" />
    </div>
  );
}
