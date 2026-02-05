import type { Metadata } from "next";

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
      <body>{children}</body>
    </html>
  );
}
