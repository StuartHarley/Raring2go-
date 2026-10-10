# Public competitions: entries, the draw and the follow-up

A competition is a published content item of type "competition". It can be entered only while it is **open**: published, listed on the public site, with a closing date (`endDate`, or `expiresAt`) that has not passed. A competition with no closing date cannot be entered or drawn.

## Entering

A signed-in parent presses **Enter this competition** on its page (a visitor who is not signed in is sent to sign in and brought back). One entry per person per competition, enforced by the database; pressing again changes nothing. The parent comes from the session cookie on the server, never from the form.

An entry holds **only who entered, when, and (after the draw) whether they won**. Entering gives **no marketing consent**: nobody is subscribed or emailed because they entered. The page says so, and says how long the entry is kept.

Each first entry records one `public_conversion` analytics event (content only, nothing about the person; recorded by the server, and the public intake endpoint refuses that event type).

## The draw

Staff with `content.competition draw` (HQ, and a franchisee for their own territory's competitions) draw winners from the competition's page in Content Studio:
- only **after the closing date has passed**, so a competition cannot be drawn while people can still enter;
- 1 to 10 winners, chosen uniformly at random with a cryptographic source (every entry has the same chance);
- **once only**: a second attempt, including two people pressing Draw at the same moment, is refused, so a result is never quietly redrawn;
- audited (`content.competition.draw`): who drew, when, how many entered, how many winners and the winning **entry ids**, never email addresses;
- winners' emails are shown only to people who may draw; everyone else sees only the entry count.

A territory's competition is that territory's to run; a network-wide one is drawn by people who work across the network.

## Privacy

- **Retention** (enforced by the daily retention job): entries that did not win are deleted 90 days after entry; winning entries 12 months after the draw.
- **Export**: a subscriber's data export includes their entries.
- **Erasure**: a data-subject erasure deletes their entries.

## The follow-up journey

The "Competition follow-up" journey (start it from Journeys, Start from a ready-made journey) thanks each entrant of a competition that closed in the last 14 days, once, and says winners are contacted directly. It goes only to entrants who **also subscribe to the area** (entering alone never signs anyone up), through the normal journey checks: suppression, frequency caps, parent email-frequency preferences.

## Not built

Winner notification emails (staff contact winners directly), prize fulfilment tracking, terms and conditions text per competition, entry questions or tie-breakers, and entries from people who are not signed in.
