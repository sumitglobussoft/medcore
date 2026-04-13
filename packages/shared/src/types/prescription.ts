export interface Prescription {
  id: string;
  appointmentId: string;
  patientId: string;
  doctorId: string;
  diagnosis: string;
  items: PrescriptionItem[];
  advice: string | null;
  followUpDate: string | null;
  signatureUrl: string | null;
  pdfUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrescriptionItem {
  id: string;
  prescriptionId: string;
  medicineName: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string | null;
}
