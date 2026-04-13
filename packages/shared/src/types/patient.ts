export enum Gender {
  MALE = "MALE",
  FEMALE = "FEMALE",
  OTHER = "OTHER",
}

export enum BloodGroup {
  A_POS = "A+",
  A_NEG = "A-",
  B_POS = "B+",
  B_NEG = "B-",
  AB_POS = "AB+",
  AB_NEG = "AB-",
  O_POS = "O+",
  O_NEG = "O-",
}

export interface Patient {
  id: string;
  userId: string;
  mrNumber: string;
  name: string;
  dateOfBirth: string | null;
  age: number | null;
  gender: Gender;
  phone: string;
  email: string | null;
  address: string | null;
  bloodGroup: BloodGroup | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  insuranceProvider: string | null;
  insurancePolicyNumber: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Vitals {
  id: string;
  appointmentId: string;
  patientId: string;
  nurseId: string;
  bloodPressureSystolic: number | null;
  bloodPressureDiastolic: number | null;
  temperature: number | null;
  weight: number | null;
  height: number | null;
  pulseRate: number | null;
  spO2: number | null;
  notes: string | null;
  recordedAt: Date;
}
