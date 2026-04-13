export enum NotificationChannel {
  WHATSAPP = "WHATSAPP",
  SMS = "SMS",
  EMAIL = "EMAIL",
  PUSH = "PUSH",
}

export enum NotificationType {
  APPOINTMENT_BOOKED = "APPOINTMENT_BOOKED",
  APPOINTMENT_REMINDER = "APPOINTMENT_REMINDER",
  APPOINTMENT_CANCELLED = "APPOINTMENT_CANCELLED",
  TOKEN_CALLED = "TOKEN_CALLED",
  PRESCRIPTION_READY = "PRESCRIPTION_READY",
  BILL_GENERATED = "BILL_GENERATED",
  PAYMENT_RECEIVED = "PAYMENT_RECEIVED",
  SCHEDULE_SUMMARY = "SCHEDULE_SUMMARY",
}

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  channel: NotificationChannel;
  title: string;
  message: string;
  data: Record<string, unknown> | null;
  sentAt: Date | null;
  readAt: Date | null;
  createdAt: Date;
}
