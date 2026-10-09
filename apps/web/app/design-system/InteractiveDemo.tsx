"use client";

import { useState } from "react";
import { Button, CommandPalette, DataTable, Drawer, Modal } from "@raring2go/ui";

const rows = [
  { id: "1", name: "Sutton Coldfield", advertisers: 42, state: "Healthy" },
  { id: "2", name: "Solihull", advertisers: 31, state: "Watch" },
  { id: "3", name: "Harborne", advertisers: 12, state: "At risk" }
];

/** Live examples of the keyboard-driven components. Each is covered by keyboard and axe tests in packages/ui. */
export function InteractiveDemo() {
  const [modal, setModal] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [last, setLast] = useState("Nothing run yet");

  return (
    <>
      <div className="ds-grid">
        <Button onClick={() => setModal(true)}>Open modal</Button>
        <Button variant="secondary" onClick={() => setDrawer(true)}>Open drawer</Button>
        <p>Press Ctrl or Cmd + K to open the command palette. Last command: <strong>{last}</strong></p>
      </div>
      <Modal open={modal} onClose={() => setModal(false)} title="Confirm approval" footer={<><Button variant="quiet" onClick={() => setModal(false)}>Cancel</Button><Button onClick={() => setModal(false)}>Approve</Button></>}>
        <p>Focus moves into this dialog, Tab stays inside it, and Escape closes it and returns focus to the button.</p>
      </Modal>
      <Drawer open={drawer} onClose={() => setDrawer(false)} title="Territory details">
        <p>A drawer behaves like a modal but slides in from the side for longer forms.</p>
      </Drawer>
      <CommandPalette
        commands={[
          { id: "design", label: "Go to design system", run: () => setLast("Go to design system") },
          { id: "tokens", label: "Show brand tokens", keywords: ["colours"], run: () => setLast("Show brand tokens") },
          { id: "audit", label: "Open audit log", hint: "Admin", run: () => setLast("Open audit log") }
        ]}
      />
      <DataTable
        caption="Territories (sortable)"
        rows={rows}
        rowKey={(row) => row.id}
        columns={[
          { key: "name", header: "Territory", render: (row) => row.name, sortValue: (row) => row.name, rowHeader: true },
          { key: "advertisers", header: "Advertisers", render: (row) => row.advertisers, sortValue: (row) => row.advertisers },
          { key: "state", header: "State", render: (row) => row.state }
        ]}
      />
    </>
  );
}
