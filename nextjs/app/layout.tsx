import type { Metadata } from "next";
import { AuthProvider } from "@/components/AuthProvider";
import "@/styles/index.scss";
import "@/styles/holidays.scss";

export const metadata: Metadata = {
  title: "Memory Loop",
  description: "Mobile-friendly interface for Obsidian vaults with Claude AI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
