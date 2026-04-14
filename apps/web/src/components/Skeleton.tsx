"use client";

import clsx from "clsx";

interface SkeletonProps {
  variant?: "text" | "circle" | "card" | "rect";
  width?: string | number;
  height?: string | number;
  className?: string;
}

export function Skeleton({
  variant = "text",
  width,
  height,
  className,
}: SkeletonProps) {
  const style: React.CSSProperties = {};
  if (width !== undefined) style.width = typeof width === "number" ? `${width}px` : width;
  if (height !== undefined) style.height = typeof height === "number" ? `${height}px` : height;

  const base = "mc-skeleton";

  switch (variant) {
    case "circle":
      return (
        <div
          className={clsx(base, "rounded-full", className)}
          style={{
            width: style.width ?? "40px",
            height: style.height ?? "40px",
          }}
        />
      );
    case "card":
      return (
        <div
          className={clsx(base, "rounded-xl", className)}
          style={{
            width: style.width ?? "100%",
            height: style.height ?? "120px",
          }}
        />
      );
    case "rect":
      return (
        <div
          className={clsx(base, "rounded", className)}
          style={{
            width: style.width ?? "100%",
            height: style.height ?? "16px",
          }}
        />
      );
    case "text":
    default:
      return (
        <div
          className={clsx(base, "h-4 rounded", className)}
          style={{
            width: style.width ?? "100%",
            height: style.height ?? "16px",
          }}
        />
      );
  }
}

/* Helpful composite skeletons */

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={clsx("space-y-2", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          variant="text"
          width={i === lines - 1 ? "70%" : "100%"}
        />
      ))}
    </div>
  );
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div
      className={clsx(
        "rounded-xl bg-white p-5 shadow-sm dark:bg-gray-800",
        className
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 space-y-2">
          <Skeleton variant="text" width="60%" />
          <Skeleton variant="text" width="40%" height={28} />
          <Skeleton variant="text" width="30%" />
        </div>
        <Skeleton variant="rect" width={40} height={40} className="rounded-lg" />
      </div>
    </div>
  );
}

export function SkeletonRow({ columns = 5 }: { columns?: number }) {
  return (
    <tr className="border-b">
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <Skeleton variant="text" />
        </td>
      ))}
    </tr>
  );
}

export function SkeletonTable({ rows = 5, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <table className="w-full">
      <tbody>
        {Array.from({ length: rows }).map((_, i) => (
          <SkeletonRow key={i} columns={columns} />
        ))}
      </tbody>
    </table>
  );
}
