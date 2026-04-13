export enum AppointmentStatus {
  BOOKED = "BOOKED",
  CHECKED_IN = "CHECKED_IN",
  IN_CONSULTATION = "IN_CONSULTATION",
  COMPLETED = "COMPLETED",
  CANCELLED = "CANCELLED",
  NO_SHOW = "NO_SHOW",
}

export enum AppointmentType {
  SCHEDULED = "SCHEDULED",
  WALK_IN = "WALK_IN",
}

export enum Priority {
  NORMAL = "NORMAL",
  URGENT = "URGENT",
  EMERGENCY = "EMERGENCY",
}

export interface TimeSlot {
  id: string;
  doctorId: string;
  date: string;
  startTime: string;
  endTime: string;
  isAvailable: boolean;
}

export interface Appointment {
  id: string;
  patientId: string;
  doctorId: string;
  date: string;
  slotId: string | null;
  tokenNumber: number;
  type: AppointmentType;
  status: AppointmentStatus;
  priority: Priority;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface QueueEntry {
  tokenNumber: number;
  patientName: string;
  patientId: string;
  appointmentId: string;
  type: AppointmentType;
  status: AppointmentStatus;
  priority: Priority;
  estimatedWaitMinutes: number;
}
