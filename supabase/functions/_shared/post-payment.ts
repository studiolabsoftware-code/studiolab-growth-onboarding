// Single-dispatch post-payment workflow.
//
// Both the Stripe webhook (`invoice.payment_succeeded`) and manage-invoice's
// `mark-paid` action funnel through `onInvoicePaid()` so the post-payment
// side effects can only ever live in one place. Phase 6.1 ships this as a
// stub — it logs the trigger and returns. Phase 6.2 will plug in:
//
//   * spawning a project for external recipients (and studios when the
//     create-invoice modal had the "Create project on payment" toggle on),
//   * dispatching the send-payment-received email (gated on stripe_mode per
//     project_email_gating_test_mode memory).
//
// Keeping the dispatcher in place from day one means Phase 6.2 lands as a
// single internal change rather than threading new call sites through both
// the webhook and manage-invoice again.

// deno-lint-ignore no-explicit-any
type Sb = any;

export type PostPaymentTrigger = 'webhook' | 'manual';

export interface PostPaymentContext {
  invoiceId: string;          // local invoices.id (uuid)
  trigger: PostPaymentTrigger;
  // Trigger-specific extras. Optional; the dispatcher reads only what each
  // downstream hook needs.
  stripeInvoiceId?: string;
  actorEmail?: string;        // who ran the manual mark-paid
  amountPaidCents?: number;
  currency?: string;
}

// Best-effort post-payment dispatch. Never throws — payment recording must
// not fail because a downstream side effect (e.g. email send) failed.
export async function onInvoicePaid(
  sb: Sb,
  ctx: PostPaymentContext,
): Promise<void> {
  try {
    console.log(
      `[post-payment] trigger=${ctx.trigger} invoice=${ctx.invoiceId} stripe=${ctx.stripeInvoiceId || '-'}`,
    );

    // Phase 6.2 hooks slot in below. They are intentionally absent in 6.1
    // so the dispatcher contract is the only thing we commit to right now.
    //
    //   await maybeSpawnProject(sb, ctx);
    //   await sendPaymentReceivedEmail(sb, ctx);
    //
    // Each hook is responsible for its own gating (stripe_mode for the
    // email; recipient kind + SKU heuristic for the project spawn).

    // Suppress unused-binding warning in stub state.
    void sb;
  } catch (err) {
    console.error('[post-payment] dispatcher error:', err);
  }
}
