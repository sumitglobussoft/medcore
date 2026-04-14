import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "@medcore/db";
import {
  Role,
  createChatRoomSchema,
  sendMessageSchema,
} from "@medcore/shared";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validate";

const router = Router();
router.use(authenticate);

// GET /api/v1/chat/users — list other users for starting a chat
router.get(
  "/users",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const users = await prisma.user.findMany({
        where: {
          id: { not: req.user!.userId },
          role: { not: "PATIENT" },
          isActive: true,
        },
        select: { id: true, name: true, email: true, role: true },
        orderBy: { name: "asc" },
      });
      res.json({ success: true, data: users, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/chat/rooms — list user's rooms
router.get(
  "/rooms",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.userId;
      const myParticipations = await prisma.chatParticipant.findMany({
        where: { userId, leftAt: null },
        select: { roomId: true, lastReadAt: true },
      });

      if (myParticipations.length === 0) {
        res.json({ success: true, data: [], error: null });
        return;
      }

      const roomIds = myParticipations.map((p) => p.roomId);
      const lastReadMap: Record<string, Date | null> = {};
      for (const p of myParticipations) lastReadMap[p.roomId] = p.lastReadAt;

      const rooms = await prisma.chatRoom.findMany({
        where: { id: { in: roomIds } },
        include: {
          participants: {
            where: { leftAt: null },
            include: {
              user: {
                select: { id: true, name: true, role: true, email: true },
              },
            },
          },
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1,
            include: {
              sender: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { lastMessageAt: "desc" },
      });

      // compute unread counts per room
      const result = await Promise.all(
        rooms.map(async (room) => {
          const lastReadAt = lastReadMap[room.id];
          const unreadWhere: Record<string, unknown> = {
            roomId: room.id,
            senderId: { not: userId },
          };
          if (lastReadAt) unreadWhere.createdAt = { gt: lastReadAt };
          const unread = await prisma.chatMessage.count({ where: unreadWhere });
          return {
            ...room,
            lastMessage: room.messages[0] || null,
            unreadCount: unread,
          };
        })
      );

      res.json({ success: true, data: result, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/chat/rooms — create room (1-on-1 returns existing)
router.post(
  "/rooms",
  validate(createChatRoomSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, isGroup, participantIds } = req.body as {
        name?: string;
        isGroup: boolean;
        participantIds: string[];
      };
      const me = req.user!.userId;

      const uniqueIds = Array.from(new Set<string>([me, ...participantIds]));

      // For 1-on-1, look for existing non-group room with exactly these 2
      if (!isGroup && uniqueIds.length === 2) {
        const other = uniqueIds.find((x) => x !== me)!;
        const mine = await prisma.chatParticipant.findMany({
          where: { userId: me },
          select: { roomId: true },
        });
        const theirs = await prisma.chatParticipant.findMany({
          where: { userId: other },
          select: { roomId: true },
        });
        const mineSet = new Set(mine.map((p) => p.roomId));
        const sharedIds = theirs
          .map((t) => t.roomId)
          .filter((r) => mineSet.has(r));
        if (sharedIds.length > 0) {
          const existing = await prisma.chatRoom.findFirst({
            where: { id: { in: sharedIds }, isGroup: false },
            include: {
              participants: {
                where: { leftAt: null },
                include: {
                  user: {
                    select: { id: true, name: true, role: true, email: true },
                  },
                },
              },
            },
          });
          if (existing) {
            res.json({ success: true, data: existing, error: null });
            return;
          }
        }
      }

      const room = await prisma.chatRoom.create({
        data: {
          name,
          isGroup,
          createdBy: me,
          participants: {
            create: uniqueIds.map((uid) => ({ userId: uid })),
          },
        },
        include: {
          participants: {
            where: { leftAt: null },
            include: {
              user: {
                select: { id: true, name: true, role: true, email: true },
              },
            },
          },
        },
      });

      res.status(201).json({ success: true, data: room, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/chat/rooms/:id/messages
router.get(
  "/rooms/:id/messages",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.userId;
      const participant = await prisma.chatParticipant.findUnique({
        where: { roomId_userId: { roomId: req.params.id, userId } },
      });
      if (!participant) {
        res
          .status(403)
          .json({ success: false, data: null, error: "Not a participant" });
        return;
      }

      const { before, limit = "50" } = req.query;
      const take = Math.min(parseInt(limit as string), 100);
      const where: Record<string, unknown> = {
        roomId: req.params.id,
        deletedAt: null,
      };
      if (before) where.createdAt = { lt: new Date(before as string) };

      const messages = await prisma.chatMessage.findMany({
        where,
        include: { sender: { select: { id: true, name: true, role: true } } },
        orderBy: { createdAt: "desc" },
        take,
      });

      res.json({
        success: true,
        data: messages,
        error: null,
        meta: {
          nextCursor:
            messages.length === take
              ? messages[messages.length - 1].createdAt.toISOString()
              : null,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/chat/rooms/:id/messages
router.post(
  "/rooms/:id/messages",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.userId;
      const body = { ...req.body, roomId: req.params.id };
      const parsed = sendMessageSchema.safeParse(body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          data: null,
          error: "Validation failed",
          details: parsed.error.flatten(),
        });
        return;
      }

      const participant = await prisma.chatParticipant.findUnique({
        where: { roomId_userId: { roomId: req.params.id, userId } },
      });
      if (!participant || participant.leftAt) {
        res
          .status(403)
          .json({ success: false, data: null, error: "Not a participant" });
        return;
      }

      const msg = await prisma.chatMessage.create({
        data: {
          roomId: req.params.id,
          senderId: userId,
          content: parsed.data.content,
          type: parsed.data.type,
          attachmentUrl: parsed.data.attachmentUrl,
        },
        include: { sender: { select: { id: true, name: true, role: true } } },
      });

      await prisma.chatRoom.update({
        where: { id: req.params.id },
        data: { lastMessageAt: new Date() },
      });

      const io = req.app.get("io");
      if (io) {
        io.to(`chat:${req.params.id}`).emit("chat:message", msg);
      }

      res.status(201).json({ success: true, data: msg, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /api/v1/chat/rooms/:id/read
router.patch(
  "/rooms/:id/read",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.userId;
      const updated = await prisma.chatParticipant.update({
        where: { roomId_userId: { roomId: req.params.id, userId } },
        data: { lastReadAt: new Date() },
      });
      res.json({ success: true, data: updated, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/chat/rooms/:id/participants — add user (group creator only)
router.post(
  "/rooms/:id/participants",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.userId;
      const { userId: addUserId } = req.body;
      if (!addUserId) {
        res
          .status(400)
          .json({ success: false, data: null, error: "userId required" });
        return;
      }

      const room = await prisma.chatRoom.findUnique({
        where: { id: req.params.id },
      });
      if (!room) {
        res
          .status(404)
          .json({ success: false, data: null, error: "Room not found" });
        return;
      }
      if (!room.isGroup) {
        res.status(400).json({
          success: false,
          data: null,
          error: "Can only add participants to group rooms",
        });
        return;
      }
      if (room.createdBy !== userId && req.user!.role !== Role.ADMIN) {
        res
          .status(403)
          .json({ success: false, data: null, error: "Only creator can add" });
        return;
      }

      // Reactivate if existed, else create
      const existing = await prisma.chatParticipant.findUnique({
        where: { roomId_userId: { roomId: req.params.id, userId: addUserId } },
      });
      let participant;
      if (existing) {
        participant = await prisma.chatParticipant.update({
          where: { id: existing.id },
          data: { leftAt: null, joinedAt: new Date() },
        });
      } else {
        participant = await prisma.chatParticipant.create({
          data: { roomId: req.params.id, userId: addUserId },
        });
      }

      res.status(201).json({ success: true, data: participant, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/v1/chat/rooms/:id/participants/:userId
router.delete(
  "/rooms/:id/participants/:userId",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const me = req.user!.userId;
      const targetUserId = req.params.userId;
      const room = await prisma.chatRoom.findUnique({
        where: { id: req.params.id },
      });
      if (!room) {
        res
          .status(404)
          .json({ success: false, data: null, error: "Room not found" });
        return;
      }
      // Allow self-removal, room creator, or admin
      if (
        targetUserId !== me &&
        room.createdBy !== me &&
        req.user!.role !== Role.ADMIN
      ) {
        res.status(403).json({ success: false, data: null, error: "Forbidden" });
        return;
      }

      const updated = await prisma.chatParticipant.update({
        where: {
          roomId_userId: { roomId: req.params.id, userId: targetUserId },
        },
        data: { leftAt: new Date() },
      });
      res.json({ success: true, data: updated, error: null });
    } catch (err) {
      next(err);
    }
  }
);

export { router as chatRouter };
