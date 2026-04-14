import {
  PrismaClient,
  FeedbackCategory,
  ComplaintStatus,
  MessageType,
  VisitorPurpose,
} from "@prisma/client";

const prisma = new PrismaClient();

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function hoursAgo(n: number) {
  const d = new Date();
  d.setHours(d.getHours() - n);
  return d;
}

async function main() {
  console.log("=== Seeding Phase 4 Engagement data ===\n");

  // ─── FEEDBACK ──────────────────────────────────
  console.log("Creating patient feedback...");
  const patients = await prisma.patient.findMany({ take: 20 });
  if (patients.length === 0) {
    console.log("No patients found. Run base seed first.");
    return;
  }

  const categories: FeedbackCategory[] = [
    "DOCTOR",
    "NURSE",
    "RECEPTION",
    "CLEANLINESS",
    "FOOD",
    "WAITING_TIME",
    "BILLING",
    "OVERALL",
  ];

  const goodComments = [
    "Excellent service, staff was very attentive.",
    "Doctor explained everything clearly.",
    "Clean and well-organized facility.",
    "Quick service, no long wait.",
    null,
    null,
  ];
  const mediumComments = [
    "Decent experience overall, but could be improved.",
    "Food was okay, not great.",
    "Waiting time was a bit long.",
    null,
  ];
  const badComments = [
    "Very long wait time, disappointed.",
    "Staff seemed rushed and inattentive.",
    "Billing took forever and was confusing.",
  ];

  await prisma.patientFeedback.deleteMany({});

  for (let i = 0; i < 20; i++) {
    const patient = patients[i % patients.length];
    const category = categories[i % categories.length];
    // Mostly 4-5, some 2-3
    const rating = Math.random() < 0.75 ? randomInt(4, 5) : randomInt(2, 3);
    const nps =
      category === "OVERALL"
        ? rating >= 4
          ? randomInt(8, 10)
          : rating >= 3
            ? randomInt(5, 7)
            : randomInt(0, 4)
        : undefined;
    const comment =
      rating >= 4
        ? randomItem(goodComments)
        : rating === 3
          ? randomItem(mediumComments)
          : randomItem(badComments);

    await prisma.patientFeedback.create({
      data: {
        patientId: patient.id,
        category,
        rating,
        nps: nps ?? null,
        comment: comment ?? null,
        submittedAt: daysAgo(randomInt(0, 90)),
      },
    });
  }
  console.log("  Created 20 feedback entries");

  // ─── COMPLAINTS ──────────────────────────────────
  console.log("\nCreating complaints...");
  await prisma.complaint.deleteMany({});

  const admins = await prisma.user.findMany({
    where: { role: "ADMIN" },
    take: 2,
  });
  const adminId = admins[0]?.id ?? null;

  const complaintSeeds: Array<{
    status: ComplaintStatus;
    priority: string;
    category: string;
    description: string;
    daysOld: number;
    resolution?: string;
    assign: boolean;
  }> = [
    {
      status: "OPEN",
      priority: "HIGH",
      category: "Billing",
      description: "Charged twice for the same consultation.",
      daysOld: 2,
      assign: false,
    },
    {
      status: "OPEN",
      priority: "CRITICAL",
      category: "Service",
      description:
        "Elderly patient was made to wait over 3 hours for emergency consultation.",
      daysOld: 9,
      assign: false,
    },
    {
      status: "UNDER_REVIEW",
      priority: "MEDIUM",
      category: "Staff Behavior",
      description: "Reception staff was rude while handling queries.",
      daysOld: 5,
      assign: true,
    },
    {
      status: "RESOLVED",
      priority: "LOW",
      category: "Cleanliness",
      description: "Washroom on 2nd floor was not maintained well.",
      daysOld: 10,
      resolution: "Housekeeping schedule updated; now cleaned every 2 hours.",
      assign: true,
    },
    {
      status: "RESOLVED",
      priority: "HIGH",
      category: "Food",
      description: "Food served was cold and tasteless during admission.",
      daysOld: 15,
      resolution: "Kitchen supervisor briefed. Temperature monitoring enforced.",
      assign: true,
    },
  ];

  for (let i = 0; i < complaintSeeds.length; i++) {
    const c = complaintSeeds[i];
    const patient = Math.random() > 0.4 ? patients[i % patients.length] : null;
    const created = daysAgo(c.daysOld);
    await prisma.complaint.create({
      data: {
        ticketNumber: `CMP${String(i + 1).padStart(6, "0")}`,
        patientId: patient?.id,
        name: patient ? null : `Anonymous Caller ${i + 1}`,
        phone: patient ? null : `98765${randomInt(10000, 99999)}`,
        category: c.category,
        description: c.description,
        status: c.status,
        priority: c.priority,
        assignedTo: c.assign ? adminId : null,
        resolution: c.resolution ?? null,
        resolvedAt: c.status === "RESOLVED" ? daysAgo(c.daysOld - 3) : null,
        createdAt: created,
        updatedAt: created,
      },
    });
  }
  console.log(`  Created ${complaintSeeds.length} complaints`);

  // ─── CHAT ──────────────────────────────────
  console.log("\nCreating chat rooms and messages...");
  await prisma.chatMessage.deleteMany({});
  await prisma.chatParticipant.deleteMany({});
  await prisma.chatRoom.deleteMany({});

  const doctors = await prisma.user.findMany({
    where: { role: "DOCTOR" },
    take: 5,
  });
  const nurses = await prisma.user.findMany({
    where: { role: "NURSE" },
    take: 5,
  });

  if (admins.length === 0) {
    console.log("  No admin user found, skipping chat seed.");
  } else {
    const admin = admins[0];

    // 1. Doctors Channel (group)
    const doctorsChannel = await prisma.chatRoom.create({
      data: {
        name: "Doctors Channel",
        isGroup: true,
        createdBy: admin.id,
        participants: {
          create: [
            { userId: admin.id },
            ...doctors.map((d) => ({ userId: d.id })),
          ],
        },
      },
    });

    const doctorMessages = [
      { senderId: admin.id, content: "Welcome to the Doctors channel!" },
      { senderId: doctors[0]?.id ?? admin.id, content: "Thanks, good to be here." },
      {
        senderId: doctors[1]?.id ?? admin.id,
        content: "Could we align on new referral SOPs?",
      },
      {
        senderId: admin.id,
        content: "Yes, let's have a meet on Friday at 10 AM.",
      },
      {
        senderId: doctors[2]?.id ?? admin.id,
        content: "Noted. Will confirm schedule.",
      },
      {
        senderId: doctors[0]?.id ?? admin.id,
        content: "Also, the OT scheduling app needs an update.",
      },
      { senderId: admin.id, content: "Raising with IT team." },
      {
        senderId: doctors[3]?.id ?? admin.id,
        content: "Perfect, thanks.",
      },
      {
        senderId: doctors[1]?.id ?? admin.id,
        content: "New patient from ER being admitted to ward 2B.",
      },
      {
        senderId: admin.id,
        content: "Ack. Please update admission record.",
      },
    ];
    for (let i = 0; i < doctorMessages.length; i++) {
      const m = doctorMessages[i];
      await prisma.chatMessage.create({
        data: {
          roomId: doctorsChannel.id,
          senderId: m.senderId,
          content: m.content,
          type: "TEXT" as MessageType,
          createdAt: hoursAgo(doctorMessages.length - i),
        },
      });
    }
    await prisma.chatRoom.update({
      where: { id: doctorsChannel.id },
      data: { lastMessageAt: hoursAgo(1) },
    });

    // 2. Nursing Team (group)
    const nursingTeam = await prisma.chatRoom.create({
      data: {
        name: "Nursing Team",
        isGroup: true,
        createdBy: admin.id,
        participants: {
          create: [
            { userId: admin.id },
            ...nurses.map((n) => ({ userId: n.id })),
          ],
        },
      },
    });

    const nurseMessages = [
      { senderId: admin.id, content: "Shift roster for next week is uploaded." },
      { senderId: nurses[0]?.id ?? admin.id, content: "Thanks, will review." },
      {
        senderId: nurses[1]?.id ?? admin.id,
        content: "Medication cart restocking today at 2 PM.",
      },
      {
        senderId: nurses[2]?.id ?? admin.id,
        content: "Copy, I'll be there.",
      },
      {
        senderId: nurses[0]?.id ?? admin.id,
        content: "Bed 304 needs attention — patient has high fever.",
      },
      { senderId: admin.id, content: "Calling the on-call doctor now." },
      { senderId: nurses[3]?.id ?? admin.id, content: "Dr. Sharma is on way." },
      {
        senderId: nurses[1]?.id ?? admin.id,
        content: "Good, vitals monitored every 30 min.",
      },
      { senderId: admin.id, content: "Appreciate the quick response team." },
      {
        senderId: nurses[2]?.id ?? admin.id,
        content: "Thanks team!",
      },
    ];
    for (let i = 0; i < nurseMessages.length; i++) {
      const m = nurseMessages[i];
      await prisma.chatMessage.create({
        data: {
          roomId: nursingTeam.id,
          senderId: m.senderId,
          content: m.content,
          type: "TEXT" as MessageType,
          createdAt: hoursAgo(nurseMessages.length - i),
        },
      });
    }
    await prisma.chatRoom.update({
      where: { id: nursingTeam.id },
      data: { lastMessageAt: hoursAgo(1) },
    });

    // 3. 1-on-1 between admin and Dr. Sharma (first doctor)
    const drSharma = doctors[0];
    if (drSharma) {
      const direct = await prisma.chatRoom.create({
        data: {
          isGroup: false,
          createdBy: admin.id,
          participants: {
            create: [{ userId: admin.id }, { userId: drSharma.id }],
          },
        },
      });

      const directMessages = [
        { senderId: admin.id, content: "Hi Dr. Sharma, got a minute?" },
        { senderId: drSharma.id, content: "Yes, what's up?" },
        {
          senderId: admin.id,
          content: "Need your input on the surgery schedule for next week.",
        },
        { senderId: drSharma.id, content: "Sure, send me the draft." },
        {
          senderId: admin.id,
          content: "Sending now via email. Please review by EOD.",
        },
        { senderId: drSharma.id, content: "Will do." },
        {
          senderId: admin.id,
          content: "Also, patient Rahul Sharma is asking for a follow-up.",
        },
        {
          senderId: drSharma.id,
          content: "Schedule him for Thursday 4 PM.",
        },
        { senderId: admin.id, content: "Done, thanks." },
        { senderId: drSharma.id, content: "Anytime!" },
      ];
      for (let i = 0; i < directMessages.length; i++) {
        const m = directMessages[i];
        await prisma.chatMessage.create({
          data: {
            roomId: direct.id,
            senderId: m.senderId,
            content: m.content,
            type: "TEXT" as MessageType,
            createdAt: hoursAgo(directMessages.length - i),
          },
        });
      }
      await prisma.chatRoom.update({
        where: { id: direct.id },
        data: { lastMessageAt: hoursAgo(1) },
      });
    }
    console.log("  Created 3 chat rooms with messages");
  }

  // ─── VISITORS ──────────────────────────────────
  console.log("\nCreating visitors...");
  await prisma.visitor.deleteMany({});

  const purposes: VisitorPurpose[] = [
    "PATIENT_VISIT",
    "DELIVERY",
    "APPOINTMENT",
    "MEETING",
    "OTHER",
  ];
  const visitorNames = [
    "Ramesh Kumar",
    "Sita Devi",
    "Anil Verma",
    "Priya Singh",
    "Arjun Reddy",
    "Meena Sharma",
    "Vikram Gupta",
    "Sunita Patel",
  ];
  const idTypes = ["Aadhaar", "PAN", "Driving License", "Passport"];
  const today = new Date();
  const yyyymmdd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;

  for (let i = 0; i < 8; i++) {
    const isActive = i < 5;
    const checkInAt = hoursAgo(isActive ? randomInt(1, 6) : randomInt(8, 20));
    const checkOutAt = isActive
      ? null
      : new Date(checkInAt.getTime() + randomInt(30, 180) * 60000);

    await prisma.visitor.create({
      data: {
        passNumber: `VIS${String(i + 1).padStart(6, "0")}-${yyyymmdd}`,
        name: visitorNames[i],
        phone: `98765${randomInt(10000, 99999)}`,
        idProofType: randomItem(idTypes),
        idProofNumber: `ID${randomInt(100000, 999999)}`,
        patientId:
          Math.random() > 0.5 ? patients[i % patients.length].id : null,
        purpose: purposes[i % purposes.length],
        department: randomItem([
          "Cardiology",
          "Orthopedics",
          "Pediatrics",
          "General",
          "ICU",
        ]),
        checkInAt,
        checkOutAt,
        notes: isActive ? null : "Checked out normally",
      },
    });
  }
  console.log("  Created 8 visitors (5 active, 3 checked out)");

  console.log("\n=== Phase 4 Engagement seed complete ===");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
