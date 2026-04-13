"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface DoctorRecord {
  id: string;
  specialization: string;
  qualification: string;
  user: { id: string; name: string; email: string; phone: string; isActive: boolean };
  schedules: Array<{
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    slotDurationMinutes: number;
  }>;
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function DoctorsPage() {
  const [doctors, setDoctors] = useState<DoctorRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDoctors();
  }, []);

  async function loadDoctors() {
    try {
      const res = await api.get<{ data: DoctorRecord[] }>("/doctors");
      setDoctors(res.data);
    } catch {
      // empty
    }
    setLoading(false);
  }

  if (loading) {
    return <div className="p-8 text-center text-gray-500">Loading...</div>;
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Doctors</h1>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {doctors.map((doc) => (
          <div key={doc.id} className="rounded-xl bg-white p-6 shadow-sm">
            <div className="mb-4">
              <h2 className="text-lg font-bold">{doc.user.name}</h2>
              <p className="text-sm text-primary">{doc.specialization}</p>
              <p className="text-xs text-gray-500">{doc.qualification}</p>
            </div>

            <div className="mb-4 text-sm">
              <p>
                <span className="text-gray-500">Email:</span> {doc.user.email}
              </p>
              <p>
                <span className="text-gray-500">Phone:</span> {doc.user.phone}
              </p>
              <p>
                <span className="text-gray-500">Status:</span>{" "}
                <span
                  className={
                    doc.user.isActive ? "text-green-600" : "text-red-600"
                  }
                >
                  {doc.user.isActive ? "Active" : "Inactive"}
                </span>
              </p>
            </div>

            <div>
              <p className="mb-2 text-sm font-medium text-gray-700">Schedule</p>
              {doc.schedules.length === 0 ? (
                <p className="text-xs text-gray-400">No schedule configured</p>
              ) : (
                <div className="space-y-1">
                  {doc.schedules
                    .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
                    .map((s, i) => (
                      <div
                        key={i}
                        className="flex justify-between text-xs"
                      >
                        <span className="text-gray-500">
                          {DAYS[s.dayOfWeek]}
                        </span>
                        <span>
                          {s.startTime} - {s.endTime} ({s.slotDurationMinutes}
                          min)
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
