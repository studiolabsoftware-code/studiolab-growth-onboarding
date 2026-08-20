# Prompt: does a real sub-account carry address, phone and website?

Paste the fenced block below into a fresh session **in the Growth Connector
repo**. That is where the adapter lives; nothing in the onboarding repo can
answer this.

## Why this is worth less than it first looked

Gary decided on 2026-08-20 that the onboarding form keeps asking for address,
phone, website and business email **regardless of the answer**. The platform's
copies are optional there and not format-guaranteed, and our capture has to be
mandatory and correctly formatted because it feeds invoices, the legal footer on
every commercial email, and carrier registration.

So this check no longer decides **whether to ask**. It only decides **whether we
can pre-fill the boxes so the studio confirms and corrects instead of typing**.
That is a real but smaller prize, and it does not block the form reshape.

**It also does not gate the signup-email cutover.** That gates on our invite path
being live, which is a different piece of work entirely.

## The prompt

```
Growth Connector. I need to know whether real GHL sub-accounts actually carry
address, phone and website, so we can decide whether the StudioLAB Growth
onboarding form can pre-fill those boxes for a studio to confirm rather than
type from scratch.

Context you should verify rather than trust:
- ghl-adapter is DEPLOYED on project hiaruvsdamggenhqdvtp.
- Its location LIST read deliberately returns only id, name, country, timezone,
  status, isAgencySubAccount, dateAdded. Address and phone are excluded on
  purpose as a PII-minimisation posture for the operator console
  (lib/internal.ts, and studios.ts).
- So the list cannot answer this. GET /locations/{id} can.

What I want:
1. Add a NARROWLY SCOPED adapter verb, get_location_detail: one location by id,
   studio-scoped, returning only address, phone, website, timezone, email.
   Do NOT widen the existing list read. Reading a studio's own address to show
   back to that studio on their own onboarding form is a different privacy case
   from an operator dashboard listing every studio, and only the first is in
   scope here.
2. Run it against two or three real sub-accounts.
3. Report, per field: populated or blank, and if populated, whether the value is
   usable as-is or would need cleaning (address split into street/city/region/
   postcode vs one free-text line; phone in a consistent format vs whatever was
   typed).

Answer the actual question: can we pre-fill these boxes with something a studio
would recognise and confirm, or would we be showing them mush they have to
retype anyway? If it is mush, say so plainly, because then we do not build it.

Full context and the tier analysis this comes from:
Growth - Onboarding/outputs/onboarding-prefill-scenario-b-plan.md
```

## What the answer changes

- **Fields are populated and clean** → build pre-fill for them. Step 2 becomes
  mostly confirmation.
- **Populated but messy** → do not build it. A studio correcting a mangled
  address is slower than typing a clean one, and we would have taught them our
  form shows them rubbish.
- **Blank fleet-wide** → the question is closed and nobody needs to ask again.
