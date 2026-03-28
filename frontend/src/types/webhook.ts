// Centralized types for webhook payloads

export interface WebhookEvent {
  id: string;
  type: string; // e.g., "payment.created", "payment.failed"
  created_at: string; // ISO timestamp
  data: Record<string, unknown>; // Event-specific payload
}

export interface PaymentCreatedEvent extends WebhookEvent {
  type: "payment.created";
  data: {
    payment_id: string;
    amount: number;
    currency: string;
    merchant_id: string;
  };
}

export interface PaymentFailedEvent extends WebhookEvent {
  type: "payment.failed";
  data: {
    payment_id: string;
    reason: string;
    merchant_id: string;
  };
}

export interface PaymentConfirmedEvent extends WebhookEvent {
  type: "payment.confirmed";
  data: {
    payment_id: string;
    confirmed_at: string; // ISO timestamp
    merchant_id: string;
  };
}

export type WebhookPayload =
  | PaymentCreatedEvent
  | PaymentFailedEvent
  | PaymentConfirmedEvent;
