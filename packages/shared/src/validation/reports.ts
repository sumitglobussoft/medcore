import { z } from "zod";

export const scheduledReportCreateSchema = z.object({
  name: z.string().min(1).max(200),
  reportType: z.enum(["DAILY_CENSUS", "WEEKLY_REVENUE", "MONTHLY_SUMMARY", "CUSTOM"]),
  frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY"]),
  dayOfWeek: z.number().int().min(0).max(6).optional(),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
  timeOfDay: z.string().regex(/^\d{2}:\d{2}$/, "Time must be HH:MM"),
  recipients: z.array(z.string().email()).min(1).max(50),
  config: z.record(z.string(), z.any()).optional(),
  active: z.boolean().optional(),
});

export const scheduledReportUpdateSchema = scheduledReportCreateSchema.partial();

export type ScheduledReportCreateInput = z.infer<typeof scheduledReportCreateSchema>;
export type ScheduledReportUpdateInput = z.infer<typeof scheduledReportUpdateSchema>;

export const dashboardPreferenceSchema = z.object({
  layout: z.object({
    widgets: z.array(
      z.object({
        type: z.string(),
        visible: z.boolean().optional(),
        order: z.number().optional(),
        config: z.record(z.string(), z.any()).optional(),
      })
    ),
  }),
});

export type DashboardPreferenceInput = z.infer<typeof dashboardPreferenceSchema>;
