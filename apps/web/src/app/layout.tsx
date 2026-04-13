import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MedCore - Hospital Operations",
  description: "Hospital Operations Automation System",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-bg min-h-screen antialiased">{children}</body>
    </html>
  );
}
