# Raring2go Digital Product Design System

FND-002 establishes the shared design language for the Raring2go Business-in-a-Box platform. The authoritative brand reference is `docs/brand/R2GO_Brand_Guidelines.pdf`.

## Brand Source

- Primary brand colours: `#852890` and `#400044`, with a restrained identity gradient.
- Seasonal accents: Spring `#93c83e`, Summer `#56cbf5`, Autumn `#fbad18`, Winter `#e01a36`.
- Logo rules: do not distort, rotate or recolour the mark. The PDF is a reference for logo usage and clear-space rules, not a production logo asset source.
- Production-ready vector/logo assets should be added separately when supplied.

## Product Evolution

The product UI evolves the 2018 print identity into a premium 2026 operating system. Purple establishes identity in navigation, primary actions, selected states and key moments. Most working surfaces remain calm, clean and readable.

## Typography

The brand guide references Avenir, VAG Rounded and Franklin Gothic ITC. These are licensing-dependent and are not bundled. The product UI uses CSS font stacks that prefer licensed installs when present and fall back to common system fonts.

Magazine print typography is separate from application UI typography. Print sizes, two-column editorial rules, cover highlight boxes, footer conventions and copy-length guidance from pages 5-7 should become future magazine template metadata.

## Semantics

Seasonal colours are edition accents, not status meanings. Accessibility tokens such as `text-primary`, `text-muted`, `border-default`, `focus-ring`, `status-success`, `status-warning` and `status-danger` prevent Spring/Summer/Autumn/Winter from being misused as success/warning/error.

## Density

The system supports comfortable and compact density modes from the same components:

- Comfortable: creative/editorial workflows and parent-facing discovery.
- Compact: HQ, Super Admin, finance and operational tables.

## FND-002 Scope

This ticket provides presentational primitives only. Command palette behaviour, drag-and-drop magazine editing, permission enforcement and domain workflows belong to later tickets.
