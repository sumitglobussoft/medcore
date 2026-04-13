export enum PaymentStatus {
  PENDING = "PENDING",
  PAID = "PAID",
  PARTIAL = "PARTIAL",
  REFUNDED = "REFUNDED",
}

export enum PaymentMode {
  CASH = "CASH",
  CARD = "CARD",
  UPI = "UPI",
  ONLINE = "ONLINE",
  INSURANCE = "INSURANCE",
}

export enum ClaimStatus {
  SUBMITTED = "SUBMITTED",
  APPROVED = "APPROVED",
  REJECTED = "REJECTED",
  SETTLED = "SETTLED",
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  appointmentId: string;
  patientId: string;
  items: InvoiceItem[];
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  totalAmount: number;
  paymentStatus: PaymentStatus;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InvoiceItem {
  id: string;
  invoiceId: string;
  description: string;
  category: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface Payment {
  id: string;
  invoiceId: string;
  amount: number;
  mode: PaymentMode;
  transactionId: string | null;
  paidAt: Date;
}

export interface InsuranceClaim {
  id: string;
  invoiceId: string;
  patientId: string;
  insuranceProvider: string;
  policyNumber: string;
  claimAmount: number;
  approvedAmount: number | null;
  status: ClaimStatus;
  submittedAt: Date;
  resolvedAt: Date | null;
}
