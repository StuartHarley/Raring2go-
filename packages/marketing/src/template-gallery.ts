import type { Block } from "./blocks";

/**
 * A small, HQ-curated set of starting points for compose - deliberately
 * static, code-versioned content rather than a database table. These aren't
 * user-editable rows: there's no per-territory authoring UI, no versioning,
 * nothing that needs a query. Every block's `id` is a fixed placeholder;
 * the compose page always regenerates fresh ids when a template is applied,
 * the same way it already does for "start from your last newsletter".
 */
export type TemplateGalleryEntry = {
  key: string;
  name: string;
  title: string;
  subject: string;
  blocks: Block[];
};

export const templateGallery: TemplateGalleryEntry[] = [
  {
    key: "welcome",
    name: "Welcome newsletter",
    title: "Welcome to our newsletter",
    subject: "Welcome, {{firstName}} - here's what to expect",
    blocks: [
      { id: "welcome-heading", type: "heading", text: "Welcome!", level: 1 },
      {
        id: "welcome-body",
        type: "text",
        html: "<p>Hi {{firstName}}, thanks for signing up. Every issue brings you the best local events, offers and family activities.</p>"
      },
      { id: "welcome-button", type: "button", label: "Explore what's on", href: "https://example.raring2go.local/whats-on" }
    ]
  },
  {
    key: "monthly-roundup",
    name: "Monthly roundup",
    title: "This month's roundup",
    subject: "Your monthly roundup is here",
    blocks: [
      { id: "roundup-heading", type: "heading", text: "This month, near you", level: 1 },
      { id: "roundup-intro", type: "text", html: "<p>Hi {{firstName}}, here's what's happening this month.</p>" },
      { id: "roundup-divider", type: "divider" },
      { id: "roundup-heading-2", type: "heading", text: "Don't miss", level: 2 },
      { id: "roundup-body", type: "text", html: "<p>Add your top picks for the month here.</p>" }
    ]
  },
  {
    key: "event-announcement",
    name: "Event announcement",
    title: "You're invited",
    subject: "You're invited: {{firstName}}, save the date",
    blocks: [
      { id: "event-heading", type: "heading", text: "You're invited", level: 1 },
      { id: "event-body", type: "text", html: "<p>Hi {{firstName}}, join us for a local event - details below.</p>" },
      { id: "event-button", type: "button", label: "See details and book", href: "https://example.raring2go.local/events" }
    ]
  },
  {
    key: "seasonal-offers",
    name: "Seasonal offers",
    title: "Seasonal offers for you",
    subject: "{{firstName}}, seasonal offers just for you",
    blocks: [
      { id: "offers-heading", type: "heading", text: "Seasonal offers", level: 1 },
      { id: "offers-body", type: "text", html: "<p>Hi {{firstName}}, here are this season's best local offers.</p>" },
      { id: "offers-divider", type: "divider" },
      { id: "offers-footer", type: "text", html: "<p>Offers are provided by local advertisers and may be time-limited.</p>" }
    ]
  },
  {
    key: "re-engagement",
    name: "We miss you",
    title: "We miss you",
    subject: "{{firstName}}, we haven't seen you in a while",
    blocks: [
      { id: "reengage-heading", type: "heading", text: "We miss you", level: 1 },
      {
        id: "reengage-body",
        type: "text",
        html: "<p>Hi {{firstName}}, it's been a while - here's what you've missed, and what's coming up.</p>"
      },
      { id: "reengage-button", type: "button", label: "See what's new", href: "https://example.raring2go.local/whats-on" }
    ]
  }
];
