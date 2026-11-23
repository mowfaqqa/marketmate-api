import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import {
  currentBusinessId,
  SessionGuard,
  type Request,
} from "../auth/session.guard";
import { Database } from "../infrastructure/database";

import { lagosToday } from "../infrastructure/lagos-date";
@Controller("dashboard")
@UseGuards(SessionGuard)
export class DashboardController {
  constructor(private readonly db: Database) {}

  @Get()
  async activity(@Req() req: Request) {
    const businessId = currentBusinessId(req);
    const today = lagosToday();
    const jobSelect = {
      id: true,
      status: true,
      channel: true,
      product: { select: { name: true } },
    } as const;
    const daySelect = {
      id: true,
      date: true,
      theme: true,
      task: true,
      job: { select: jobSelect },
    } as const;
    const visibleDay = {
      plan: { businessId },
      completedAt: null,
      job: { businessId, archived: false, product: { archivedAt: null } },
    };
    const [recent, pending, todayItems, overdue, overdueCount] =
      await Promise.all([
        this.db.studioJob.findMany({
          where: {
            businessId,
            archived: false,
            status: "ready",
            drafts: { some: {} },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 5,
          select: jobSelect,
        }),
        this.db.studioJob.findMany({
          where: {
            businessId,
            archived: false,
            status: { in: ["pending", "running"] },
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: 5,
          select: jobSelect,
        }),
        this.db.marketingDay.findMany({
          where: { ...visibleDay, date: today },
          orderBy: { id: "asc" },
          take: 5,
          select: daySelect,
        }),
        this.db.marketingDay.findMany({
          where: { ...visibleDay, date: { lt: today } },
          orderBy: [{ date: "asc" }, { id: "asc" }],
          take: 5,
          select: daySelect,
        }),
        this.db.marketingDay.count({
          where: { ...visibleDay, date: { lt: today } },
        }),
      ]);
    return { today, recent, pending, todayItems, overdue, overdueCount };
  }
}
